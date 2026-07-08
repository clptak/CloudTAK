import { defineConfig, type ResolvedConfig, type Plugin, type ViteDevServer } from 'vite'
import fs from 'node:fs';
import path from 'node:path';
import vue from '@vitejs/plugin-vue'
import type { IncomingMessage, ServerResponse } from 'node:http';

const milsymbolBrowserBundle = path.resolve(__dirname, 'node_modules/milsymbol/dist/milsymbol.js');
const webRoot = __dirname;

function isDevPluginImporter(importer: string | undefined): boolean {
    if (!importer) return false;
    const file = importer.replace(/^virtual-module:/, '').split('?')[0];
    return file.includes('/dev/cloudtak-');
}

function resolveSymlinkedHostImport(source: string, importer: string | undefined): string | null {
    if (!isDevPluginImporter(importer)) return null;

    const srcMatch = source.match(/^((?:\.\.\/)+)src\/(.+)$/);
    if (srcMatch) {
        return path.resolve(webRoot, 'src', srcMatch[2]);
    }

    if (/^((?:\.\.\/)+)plugin\.ts$/.test(source)) {
        return path.resolve(webRoot, 'plugin.ts');
    }

    return null;
}

/** Plugins symlinked to ~/dev/* resolve imports from the real path, not api/web/plugins/. */
function symlinkedPluginResolve(): Plugin {
    const anchor = path.join(webRoot, 'src/main.ts');

    return {
        name: 'symlinked-plugin-resolve',
        enforce: 'pre',
        async resolveId(source: string, importer: string | undefined): Promise<string | null> {
            const host = resolveSymlinkedHostImport(source, importer);
            if (host) return host;

            if (
                isDevPluginImporter(importer)
                && !source.startsWith('.')
                && !source.startsWith('\0')
                && !source.includes(':')
            ) {
                const resolved = await this.resolve(source, anchor, { skipSelf: true });
                if (!resolved) return null;
                return typeof resolved === 'string' ? resolved : (resolved.id ?? null);
            }

            return null;
        },
    };
}

const symlinkedHostAlias = {
    find: /^((?:\.\.\/)+)src\/(.+)$/,
    replacement: '$2',
    customResolver(source: string, importer: string | undefined) {
        return resolveSymlinkedHostImport(source, importer) ?? undefined;
    },
};

const symlinkedPluginAlias = {
    find: /^((?:\.\.\/)+)plugin\.ts$/,
    replacement: 'plugin.ts',
    customResolver(source: string, importer: string | undefined) {
        return resolveSymlinkedHostImport(source, importer) ?? undefined;
    },
};

/**
 * Vite compiles `?worker&url` bundles (Atlas + MapLibre workers) and their
 * chunks in a separate build it never records in `manifest.json`, so the
 * service worker's manifest-driven precache misses them and `new Worker(...)`
 * 404s after a deploy. This injects those leftover chunks back into the
 * manifest as synthetic `worker:` entries, so the SW's normal walk precaches them.
 */
function precacheWorkerAssetsPlugin(): Plugin {
    let outDir = 'dist';

    return {
        name: 'cloudtak-precache-worker-assets',
        apply: 'build',
        configResolved(config: ResolvedConfig) {
            outDir = path.resolve(config.root, config.build.outDir);
        },
        closeBundle() {
            const manifestPath = path.join(outDir, '.vite', 'manifest.json');
            const assetsDir = path.join(outDir, 'assets');

            if (!fs.existsSync(manifestPath) || !fs.existsSync(assetsDir)) return;

            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, {
                file?: string;
                name?: string;
                src?: string;
                css?: string[];
                assets?: string[];
            }>;

            const referenced = new Set<string>();
            for (const entry of Object.values(manifest)) {
                if (entry.file) referenced.add(entry.file);
                for (const file of entry.css ?? []) referenced.add(file);
                for (const file of entry.assets ?? []) referenced.add(file);
            }

            const workerAssets = fs.readdirSync(assetsDir)
                .map((name) => `assets/${name}`)
                .filter((rel) => (rel.endsWith('.js') || rel.endsWith('.css')) && !referenced.has(rel))
                .sort();

            for (const file of workerAssets) {
                manifest[`worker:${file}`] = { file, src: `worker:${file}` };
            }

            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

            console.log(`[vite] Injected ${workerAssets.length} worker asset(s) into the manifest for service-worker precache`);
        },
    };
}

export default defineConfig(() => {
    const symlinkPluginResolve = symlinkedPluginResolve();
    const symlinkAliases = [symlinkedHostAlias, symlinkedPluginAlias];

    return {
        define: {
            'import.meta.env.HASH': JSON.stringify(Math.random().toString(36).substring(2, 15)),
        },
        plugins: [
            symlinkPluginResolve,
            vue(),
            precacheWorkerAssetsPlugin(),
            {
                name: 'configure-server',
                configureServer(server: ViteDevServer) {
                    server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: (err?: any) => void) => {
                        if (req.url?.startsWith('/admin') && !path.extname(req.url)) {
                            req.url = '/admin.html';
                        } else if (req.url?.startsWith('/connection') && !path.extname(req.url)) {
                            req.url = '/connection.html';
                        } else if (req.url?.startsWith('/setup') && !path.extname(req.url)) {
                            req.url = '/setup.html';
                        }
                        next();
                    });
                }
            }
        ],
        optimizeDeps: {
            include: ["showdown", "@tak-ps/vue-tabler"],
        },
        resolve: {
            alias: [
                ...symlinkAliases,
                { find: 'milsymbol', replacement: milsymbolBrowserBundle },
                { find: '@tak-ps/cloudtak', replacement: path.resolve(__dirname, './plugin.ts') },
                { find: '@', replacement: path.resolve(__dirname, './src') },
                { find: '@cloudtak/api-types', replacement: path.resolve(__dirname, '../derived-types.d.ts') },
            ],
        },
        build: {
            manifest: true,
            target: 'esnext',
            rolldownOptions: {
                input: {
                    main: path.resolve(__dirname, 'index.html'),
                    docs: path.resolve(__dirname, 'docs.html'),
                    video: path.resolve(__dirname, 'video.html'),
                    admin: path.resolve(__dirname, 'admin.html'),
                    connection: path.resolve(__dirname, 'connection.html'),
                    setup: path.resolve(__dirname, 'setup.html'),
                },
            },
        },
        worker: {
            format: 'es' as const,
        },
        server: {
            port: 8080,
            proxy: {
                '/api': {
                    ws: true,
                    target: 'http://localhost:5001',
                    changeOrigin: true,
                }
            }
        },
        test: {
            environment: 'jsdom',
            globals: true,
            deps: {
                inline: ['@tak-ps/vue-tabler']
            },
            setupFiles: ['./src/test/setup.ts'],
            coverage: {
                provider: 'v8',
                reporter: ['text', 'lcov'],
                include: ['src/**'],
                exclude: [
                    'src/test/**',
                    '**/*.spec.ts',
                    '**/*.d.ts',
                ],
            },
        },
    };
})
