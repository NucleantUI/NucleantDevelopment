// Nucleant Preview: builds a NucleantUI app for WebAssembly with
// NucleantApplication's scripts/build_wasm_app.py, serves the page from a
// local server and shows it in a panel beside the editor. Saving a Swift file
// rebuilds; a successful build reloads every open page (the panel and any
// browser tab) through a server-sent event the server adds to index.html.
//
// Two modes, one button each:
//   app       the app itself, as `@main` runs it.
//   previews  a NUCLEANT_PREVIEW build (`--preview`): `NucleantApp.main()`
//             runs PreviewRuntime instead, the app's `@Preview` functions as
//             tabs — those of the file in the editor: focusing a file of the
//             package with `@Preview`s in it reloads the page with
//             NUCLEANT_PREVIEW_FILE set to it (no rebuild). The lock in
//             the panel's title bar keeps it on that file meanwhile.
//
// One session at a time: a mode, a package directory, one executable
// product of it, the page directory the build writes, and the server in
// front of it.

'use strict';

const vscode = require('vscode');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const EVENTS_PATH = '/__nucleant_preview/events';
const REPORT_PATH = '/__nucleant_preview/report';

/** @type {Session | undefined} */
let session;
/** @type {vscode.OutputChannel} */
let output;
/** @type {vscode.StatusBarItem} */
let statusItem;
/** @type {vscode.ExtensionContext} */
let extensionContext;
/** The text editor focused last, which the previews follow again when unlocked. */
let lastDocument;

function activate(context) {
    extensionContext = context;
    output = vscode.window.createOutputChannel('Nucleant Preview');
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    statusItem.command = 'nucleantPreview.showLog';
    context.subscriptions.push(
        output,
        statusItem,
        vscode.commands.registerCommand('nucleantPreview.runApp', (uri) => openSession(uri, 'app', false)),
        vscode.commands.registerCommand('nucleantPreview.showPreviews', (uri) => openSession(uri, 'previews', false)),
        vscode.commands.registerCommand('nucleantPreview.chooseProduct', (uri) => openSession(uri, session?.mode ?? 'app', true)),
        vscode.commands.registerCommand('nucleantPreview.openInBrowser', () => session && vscode.env.openExternal(vscode.Uri.parse(session.url))),
        vscode.commands.registerCommand('nucleantPreview.rebuild', () => session?.requestBuild('rebuild requested')),
        vscode.commands.registerCommand('nucleantPreview.stop', () => stopSession()),
        vscode.commands.registerCommand('nucleantPreview.showLog', () => output.show(true)),
        vscode.commands.registerCommand('nucleantPreview.lock', () => session?.setLocked(true)),
        vscode.commands.registerCommand('nucleantPreview.unlock', () => session?.setLocked(false)),
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (setting('buildOnSaveOnly')) session?.fileChanged(document.uri.fsPath);
            // Its first `@Preview` may just have been written: shown once
            // the build that adds it lands.
            if (document === vscode.window.activeTextEditor?.document) session?.focus(document, false);
        }),
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (!editor) return;
            lastDocument = editor.document;
            session?.focus(editor.document, true);
        }),
    );
    const watcher = vscode.workspace.createFileSystemWatcher('**/{*.swift,Package.swift}');
    const onDisk = (uri) => {
        if (!setting('buildOnSaveOnly')) session?.fileChanged(uri.fsPath);
    };
    context.subscriptions.push(watcher, watcher.onDidChange(onDisk), watcher.onDidCreate(onDisk), watcher.onDidDelete(onDisk));
    // For the extension's integration test: what the running session sees.
    return { get session() { return session; } };
}

function deactivate() {
    stopSession();
}

function setting(name) {
    return vscode.workspace.getConfiguration('nucleantPreview').get(name);
}

// MARK: - Choosing what to preview

/** The package and product to show in `mode`, starting from `uri` or the active editor. */
async function openSession(uri, mode, choose) {
    const file = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!file) {
        vscode.window.showErrorMessage('Nucleant Preview: open a Swift file of the package to preview.');
        return;
    }
    const packageDir = findUp(path.dirname(file), (dir) => fs.existsSync(path.join(dir, 'Package.swift')));
    if (!packageDir) {
        vscode.window.showErrorMessage(`Nucleant Preview: no Package.swift above ${file}.`);
        return;
    }
    const buildScript = findBuildScript(packageDir);
    if (!buildScript) {
        vscode.window.showErrorMessage('Nucleant Preview: NucleantApplication/scripts/build_wasm_app.py not found. Set nucleantPreview.buildScript.');
        return;
    }
    const product = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `Nucleant Preview: reading ${path.basename(packageDir)}/Package.swift` },
        () => chooseProduct(packageDir, choose));
    if (!product) return;

    const document = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === file);
    if (session && session.mode === mode && session.packageDir === packageDir && session.product === product) {
        session.reveal();
        // Asked for by name: switches even when locked (and stays locked).
        if (document) session.focus(document, true, true);
        return;
    }
    stopSession();
    session = new Session(mode, packageDir, product, buildScript);
    if (document) session.focus(document, false);
    await session.start();
}

function findUp(start, predicate) {
    for (let dir = start; ; dir = path.dirname(dir)) {
        if (predicate(dir)) return dir;
        if (path.dirname(dir) === dir) return undefined;
    }
}

function findBuildScript(packageDir) {
    const configured = setting('buildScript');
    if (configured) return fs.existsSync(configured) ? configured : undefined;
    const relative = path.join('NucleantApplication', 'scripts', 'build_wasm_app.py');
    const root = findUp(packageDir, (dir) => fs.existsSync(path.join(dir, relative)));
    return root && path.join(root, relative);
}

/** An executable product of the package: the only one, the one used last time, or picked. */
async function chooseProduct(packageDir, forceChoice) {
    const key = `product:${packageDir}`;
    const remembered = extensionContext.workspaceState.get(key);
    let products;
    try {
        products = await executableProducts(packageDir);
    } catch (error) {
        output.appendLine(`swift package dump-package failed: ${error.message}`);
        products = [];
    }
    let product;
    if (!forceChoice && remembered && (products.length === 0 || products.includes(remembered))) {
        product = remembered;
    } else if (!forceChoice && products.length === 1) {
        product = products[0];
    } else if (products.length > 0) {
        product = await vscode.window.showQuickPick(products, { placeHolder: `Product of ${path.basename(packageDir)} to preview` });
    } else {
        product = await vscode.window.showInputBox({ prompt: `Executable product of ${path.basename(packageDir)} to preview`, value: remembered ?? path.basename(packageDir) });
    }
    if (product) await extensionContext.workspaceState.update(key, product);
    return product;
}

/**
 * Names of the package's executable products, from its manifest. An
 * `executableTarget` with no product declared for it (the examples) is one
 * too: SwiftPM makes the product implicitly.
 */
function executableProducts(packageDir) {
    return new Promise((resolve, reject) => {
        cp.execFile('swift', ['package', 'dump-package'], { cwd: packageDir, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
            if (error) return reject(error);
            try {
                const manifest = JSON.parse(stdout);
                const declared = manifest.products.filter((p) => p.type && 'executable' in p.type).map((p) => p.name);
                const targets = manifest.targets.filter((t) => t.type === 'executable').map((t) => t.name);
                resolve([...new Set([...declared, ...targets])]);
            } catch (parseError) {
                reject(parseError);
            }
        });
    });
}

function stopSession() {
    session?.dispose();
    session = undefined;
    vscode.commands.executeCommand('setContext', 'nucleantPreview.running', false);
    vscode.commands.executeCommand('setContext', 'nucleantPreview.previews', false);
    vscode.commands.executeCommand('setContext', 'nucleantPreview.locked', false);
    statusItem.hide();
}

// MARK: - Session

class Session {
    constructor(mode, packageDir, product, buildScript) {
        this.mode = mode;
        this.packageDir = packageDir;
        this.product = product;
        this.buildScript = buildScript;
        // Page directories of their own, so neither replaces the one
        // `build_wasm_app.py` writes for a plain run (.build/wasm-app/<product>).
        this.pageDir = path.join(packageDir, '.build', mode === 'previews' ? 'wasm-preview-app' : 'wasm-live', product);
        /** The file whose previews are shown; all of the app's until one is focused. */
        this.file = undefined;
        /** Stays on `file` whatever is focused; saves still rebuild and reload it. */
        this.locked = false;
        // The preview tab last open in each file (and '' for all of them),
        // as PreviewRuntime reported it, handed back on every load so a
        // rebuild or coming back to the file reopens it. Kept per app across
        // VS Code sessions.
        this.selectedKey = `selected:${this.pageDir}`;
        const stored = extensionContext.workspaceState.get(this.selectedKey);
        this.selected = stored && typeof stored === 'object' ? stored : {};
        /** Reload when the running build ends, whether or not it relinked. */
        this.reloadAfterBuild = false;
        this.wasm = path.join(this.pageDir, `${product}.wasm`);
        /** The page's module as this session last saw it (mtime). */
        this.knownWasm = modified(this.wasm);
        // Saves anywhere in the checkout that holds NucleantApplication (the
        // development tree: the app and every path dependency it builds
        // against) count, not only the package's own sources.
        this.watchRoot = path.dirname(path.dirname(path.dirname(buildScript)));
        /** @type {http.ServerResponse[]} */
        this.clients = [];
        /** What the pages reported: their environment, start-up, errors. */
        this.reports = [];
        this.building = undefined;
        this.pending = false;
        this.debounce = undefined;
        this.state = { kind: 'idle' };
    }

    get title() {
        if (this.mode === 'app') return `App: ${this.product}`;
        return `${this.locked ? 'Locked previews' : 'Previews'}: ${this.product}${this.file ? ` — ${path.basename(this.file)}` : ''}`;
    }

    get url() {
        return `http://127.0.0.1:${this.server.address().port}/`;
    }

    async start() {
        await this.listen();
        vscode.commands.executeCommand('setContext', 'nucleantPreview.running', true);
        vscode.commands.executeCommand('setContext', 'nucleantPreview.previews', this.mode === 'previews');
        output.appendLine(`${this.title} (${this.packageDir}) at ${this.url}`);
        this.reveal();
        // The page directory can also be rebuilt from outside (by hand, a
        // script): then whatever this session last said — a failure above
        // all — is about a module the page no longer runs.
        fs.watchFile(this.wasm, { interval: 1000 }, () => this.wasmChanged());
        this.requestBuild('preview opened', 0);
    }

    /**
     * Shows `document`'s previews if it is a Swift file of this package with
     * a `@Preview` in it; anything else leaves the shown ones as they are.
     * `now`: reload the page at once, rather than after the build a save
     * starts. While locked, only an `explicit` request (Show Previews on a
     * file) switches.
     */
    focus(document, now, explicit = false) {
        if (this.locked && !explicit) return;
        if (this.mode !== 'previews' || document.languageId !== 'swift' || document.uri.scheme !== 'file') return;
        if (!/^\s*@Preview\b/m.test(document.getText())) return;
        // #filePath is the path the compiler was given: SwiftPM's, with
        // symbolic links resolved.
        let file = document.uri.fsPath;
        try { file = fs.realpathSync(file); } catch {}
        const owner = findUp(path.dirname(file), (dir) => fs.existsSync(path.join(dir, 'Package.swift')));
        if (owner !== this.packageDir || file === this.file) return;
        this.file = file;
        output.appendLine(`previews of ${path.relative(this.packageDir, file)}`);
        if (this.server) this.showStatus();
        if (!this.server) return;
        if (now && !this.building && !this.scheduled) this.broadcast('reload', {});
        else this.reloadAfterBuild = true;
    }

    /** Locking keeps the shown file; unlocking follows the editor again, from the file focused last. */
    setLocked(locked) {
        if (this.mode !== 'previews' || locked === this.locked) return;
        this.locked = locked;
        vscode.commands.executeCommand('setContext', 'nucleantPreview.locked', locked);
        output.appendLine(locked ? `locked to ${this.file ? path.relative(this.packageDir, this.file) : 'all previews'}` : 'unlocked: following the editor');
        this.showStatus();
        if (!locked && lastDocument) this.focus(lastDocument, true);
    }

    wasmChanged() {
        if (this.building || this.disposed) return;
        const now = modified(this.wasm);
        if (now === undefined || now === this.knownWasm) return;
        this.knownWasm = now;
        output.appendLine(`\n── ${new Date().toLocaleTimeString()} ${this.product}.wasm rebuilt outside the preview ──`);
        this.setState({ kind: 'ready' });
        this.broadcast('reload', {});
    }

    // MARK: Server

    listen() {
        this.server = http.createServer((request, response) => this.handle(request, response));
        return new Promise((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(0, '127.0.0.1', resolve);
        });
    }

    handle(request, response) {
        const url = new URL(request.url, 'http://127.0.0.1');
        if (url.pathname === REPORT_PATH && request.method === 'POST') {
            let body = '';
            request.on('data', (chunk) => { body = (body + chunk).slice(0, 16000); });
            request.on('end', () => {
                response.writeHead(204).end();
                try {
                    const report = JSON.parse(body);
                    if (report.kind === 'selected') {
                        this.selected[this.file ?? ''] = report.text;
                        extensionContext.workspaceState.update(this.selectedKey, this.selected);
                    }
                    this.reports.push(report);
                    if (this.reports.length > 200) this.reports.shift();
                    output.appendLine(`[page] ${report.kind}: ${report.text}`);
                } catch {}
            });
            return;
        }
        if (url.pathname === EVENTS_PATH) {
            response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
            response.write(`event: state\ndata: ${JSON.stringify(this.state)}\n\n`);
            this.clients.push(response);
            request.on('close', () => { this.clients = this.clients.filter((c) => c !== response); });
            return;
        }
        const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
        const file = path.join(this.pageDir, relative);
        if (!file.startsWith(this.pageDir + path.sep)) {
            response.writeHead(403).end();
            return;
        }
        if (relative === '/index.html') {
            const page = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : placeholderPage(this.product);
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(injectReloadScript(this.mode === 'previews' ? withEnvironment(page, this.previewEnvironment()) : page));
            return;
        }
        fs.stat(file, (error, stat) => {
            if (error || !stat.isFile()) {
                response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
                return;
            }
            response.writeHead(200, { 'Content-Type': contentType(file), 'Content-Length': stat.size, 'Cache-Control': 'no-store' });
            fs.createReadStream(file).pipe(response);
        });
    }

    /** What PreviewRuntime is launched with: the file whose previews to show, and the tab to open. */
    previewEnvironment() {
        const env = {};
        if (this.file) env.NUCLEANT_PREVIEW_FILE = this.file;
        const selected = this.selected[this.file ?? ''];
        if (selected) env.NUCLEANT_PREVIEW_SELECTED = selected;
        return env;
    }

    /** Tells every open page what the build is doing; `reload` makes them reload. */
    broadcast(event, data) {
        for (const client of this.clients) client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    setState(state) {
        this.state = state;
        this.broadcast('state', state);
        this.showStatus();
    }

    /** The state and title in the status bar and the panel's tab. */
    showStatus() {
        const state = this.state;
        const icons = { building: '$(sync~spin)', ready: '$(check)', failed: '$(error)', idle: '$(open-preview)' };
        const detail = {
            building: state.total ? `building ${state.done}/${state.total}` : 'building',
            ready: state.seconds ? `built in ${state.seconds}s` : 'ready',
            failed: 'build failed',
            idle: '',
        }[state.kind];
        statusItem.text = `${icons[state.kind]} ${this.title}${detail ? ` — ${detail}` : ''}`;
        statusItem.tooltip = `Nucleant Preview: ${state.step ?? state.kind}\nClick for the build log`;
        statusItem.backgroundColor = state.kind === 'failed' ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
        statusItem.show();
        if (this.panel) {
            const suffix = { building: state.total ? ` (building ${Math.floor(100 * state.done / state.total)}%)` : ' (building)', failed: ' (failed)' }[state.kind] ?? '';
            this.panel.title = `${this.title}${suffix}`;
        }
    }

    // MARK: Panel

    reveal() {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside, true);
            return;
        }
        this.panel = vscode.window.createWebviewPanel('nucleantPreview', this.title,
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            // Kept alive while hidden: reloading the module on every tab
            // switch would throw away the app's state.
            { enableScripts: true, retainContextWhenHidden: true });
        this.panel.onDidDispose(() => { this.panel = undefined; });
        vscode.env.asExternalUri(vscode.Uri.parse(this.url)).then((external) => {
            if (this.panel) this.panel.webview.html = panelHTML(external.toString(true), this.mode === 'previews');
        });
    }

    // MARK: Building

    fileChanged(file) {
        if (!file.startsWith(this.watchRoot + path.sep)) return;
        if (file.split(path.sep).includes('.build')) return;
        this.requestBuild(path.relative(this.watchRoot, file));
    }

    requestBuild(reason, delay = setting('debounceMs')) {
        clearTimeout(this.debounce);
        this.scheduled = true;
        this.debounce = setTimeout(() => {
            this.scheduled = false;
            if (this.building) {
                // One more build once this one ends: what it compiled may
                // predate the change.
                this.pending = true;
                return;
            }
            this.build(reason);
        }, delay);
    }

    build(reason) {
        const before = modified(this.wasm);
        const args = [this.buildScript, this.product, '--package-path', this.packageDir, '--output', this.pageDir];
        if (setting('release')) args.push('--release');
        if (this.mode === 'previews') args.push('--preview');
        // The script also takes NUCLEANT_PREVIEW=1 from its environment: an
        // app run must not inherit one from the editor's.
        const env = { ...process.env };
        delete env.NUCLEANT_PREVIEW;

        output.appendLine(`\n── ${new Date().toLocaleTimeString()} build (${reason}) ──`);
        const started = Date.now();
        // SwiftPM's `[done/total] step` lines, passed on at most every
        // 200 ms: a full build prints thousands.
        const progress = { kind: 'building', started, done: 0, total: 0, step: 'Starting the build' };
        let sent = 0;
        const report = (force) => {
            if (!force && Date.now() - sent < 200) return;
            sent = Date.now();
            this.setState({ ...progress });
        };
        report(true);
        let partial = '';
        const child = cp.spawn(setting('python'), args, { cwd: this.packageDir, env });
        this.building = child;
        let tail = '';
        const collect = (chunk) => {
            const text = chunk.toString();
            output.append(text);
            tail = (tail + text).slice(-4000);
            const lines = (partial + text).split(/\r?\n/);
            partial = lines.pop();
            for (const line of lines) {
                const step = line.match(/^\[(\d+)\/(\d+)\]\s*(.*)$/);
                if (step) {
                    progress.done = Number(step[1]);
                    progress.total = Number(step[2]);
                    progress.step = step[3];
                } else if (/^Building for /.test(line)) {
                    progress.step = 'Planning the build';
                } else if (/^Build (of product .* )?complete/.test(line)) {
                    progress.step = 'Laying out the page';
                } else if (/\berror:/.test(line)) {
                    progress.step = 'Errors — the build will fail';
                }
            }
            report(false);
        };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        child.on('error', (error) => collect(`${error.message}\n`));
        child.on('close', (code) => {
            this.building = undefined;
            if (this.disposed) return;
            this.knownWasm = modified(this.wasm);
            const seconds = ((Date.now() - started) / 1000).toFixed(1);
            if (code === 0) {
                output.appendLine(`build finished in ${seconds}s`);
                this.setState({ kind: 'ready', seconds, step: `built in ${seconds}s` });
                // A save that changed nothing the module is built from
                // relinks nothing; keep the running page and its state.
                if (this.knownWasm !== before || this.reloadAfterBuild) this.broadcast('reload', {});
                this.reloadAfterBuild = false;
            } else {
                output.appendLine(`build failed (exit ${code}) after ${seconds}s`);
                this.setState({ kind: 'failed', log: errorLines(tail) });
            }
            if (this.pending) {
                this.pending = false;
                this.build('changes during the last build');
            }
        });
    }

    dispose() {
        this.disposed = true;
        clearTimeout(this.debounce);
        this.building?.kill('SIGINT');
        fs.unwatchFile(this.wasm);
        for (const client of this.clients) client.end();
        this.server?.close();
        this.panel?.dispose();
    }
}

function modified(file) {
    try {
        return fs.statSync(file).mtimeMs;
    } catch {
        return undefined;
    }
}

/** The compiler's `error:` lines from the end of the log, or its last lines. */
function errorLines(log) {
    const lines = log.split('\n');
    const errors = lines.filter((line) => /\berror:/.test(line));
    return (errors.length ? errors : lines).slice(-12).join('\n');
}

function contentType(file) {
    const types = {
        '.wasm': 'application/wasm', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
        '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
        '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2',
    };
    return types[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

// MARK: - Pages

/**
 * The page with `env` in the module's environment (NucleantApplication's
 * page passes `options.env` through to WASI).
 */
function withEnvironment(page, env) {
    if (Object.keys(env).length === 0) return page;
    const call = 'runNucleantApp({';
    if (!page.includes(call)) {
        output.appendLine(`index.html has no '${call}' — cannot pass ${Object.keys(env).join(', ')}`);
        return page;
    }
    return page.replace(call, `${call} env: ${JSON.stringify(env)},`);
}

/** The page's live-reload hook: a badge while building, the errors when a build fails, a reload when one lands. */
function injectReloadScript(page) {
    const script = `
<style>
  #nucleant-preview-bar { position: fixed; inset: 0 0 auto 0; height: 3px; z-index: 2147483647; pointer-events: none; background: transparent; }
  #nucleant-preview-bar > div { height: 100%; width: 0; background: #6aa0ff; transition: width 0.2s; }
  #nucleant-preview-bar[data-indeterminate] > div { width: 30%; animation: nucleant-preview-slide 1.2s ease-in-out infinite; }
  @keyframes nucleant-preview-slide { from { margin-left: -30%; } to { margin-left: 100%; } }
  #nucleant-preview-badge { position: fixed; top: 10px; left: 8px; z-index: 2147483647; max-width: min(720px, calc(100vw - 16px));
    padding: 6px 10px; border-radius: 6px; font: 12px/1.4 ui-monospace, monospace; font-variant-numeric: tabular-nums; white-space: pre-wrap;
    background: rgb(30 30 36 / 0.88); color: #eee; pointer-events: none; overflow: hidden; text-overflow: ellipsis; }
  #nucleant-preview-badge[data-kind="failed"] { background: rgb(150 20 30 / 0.92); pointer-events: auto; cursor: pointer; }
  #nucleant-preview-badge[data-kind="ready"] { background: rgb(30 110 60 / 0.9); }
  #nucleant-preview-badge[data-kind="offline"] { background: rgb(120 90 20 / 0.92); }
  #nucleant-preview-badge[hidden], #nucleant-preview-bar[hidden] { display: none; }
</style>
<div id="nucleant-preview-bar" hidden><div></div></div>
<div id="nucleant-preview-badge" hidden></div>
<script>
  (() => {
    const badge = document.getElementById('nucleant-preview-badge');
    const bar = document.getElementById('nucleant-preview-bar');
    // In the panel, the app focusing its window as it starts would take
    // the keyboard from the editor on every reload: it may only while the
    // panel has it. Focus given to the panel's frame goes to the window.
    if (window.parent !== window) {
      const focus = HTMLElement.prototype.focus;
      HTMLElement.prototype.focus = function (...args) { if (document.hasFocus()) focus.apply(this, args); };
      addEventListener('focus', () => {
        const window = document.querySelector('#app canvas');
        if (window && document.activeElement === document.body) focus.call(window);
      });
    }
    let state = { kind: 'idle' };
    let hideTimer;
    const render = () => {
      clearTimeout(hideTimer);
      badge.dataset.kind = state.kind;
      bar.hidden = state.kind !== 'building';
      if (state.kind === 'building') {
        const seconds = Math.round((Date.now() - state.started) / 1000);
        const count = state.total ? state.done + '/' + state.total + ' · ' : '';
        badge.textContent = 'Building… ' + count + seconds + 's\\n' + state.step;
        badge.hidden = false;
        bar.toggleAttribute('data-indeterminate', !state.total);
        bar.firstElementChild.style.width = state.total ? (100 * state.done / state.total) + '%' : '';
      } else if (state.kind === 'failed') {
        badge.textContent = 'Build failed (click to hide)\\n\\n' + state.log;
        badge.hidden = false;
      } else if (state.kind === 'offline') {
        badge.textContent = 'Preview server not reachable — is the preview still open in VS Code?';
        badge.hidden = false;
      } else if (state.kind === 'ready' && state.step) {
        // Shown briefly when a build ends without a reload (nothing relinked).
        badge.textContent = state.step;
        badge.hidden = false;
        hideTimer = setTimeout(() => { badge.hidden = true; }, 1500);
      } else {
        badge.hidden = true;
      }
    };
    setInterval(() => { if (state.kind === 'building') render(); }, 1000);
    badge.addEventListener('click', () => { badge.hidden = true; });
    // What happens in the page goes to the extension's output: the GPU and
    // JSPI it has, whether the app came up, and every error — a trap in
    // the module surfaces as one.
    const report = (kind, text) => fetch('${REPORT_PATH}', { method: 'POST', body: JSON.stringify({ kind, text: String(text).slice(0, 4000) }), keepalive: true }).catch(() => {});
    // PreviewRuntime prints the open tab when it changes (on stdout, which
    // the page's WASI writes to console.log); the extension keeps it and
    // hands it back on the next load.
    const originalLog = console.log.bind(console);
    console.log = (...args) => {
      originalLog(...args);
      const line = String(args[0] ?? '');
      if (line.startsWith('NUCLEANT_PREVIEW_SELECTED=')) report('selected', line.slice('NUCLEANT_PREVIEW_SELECTED='.length));
    };
    const originalError = console.error.bind(console);
    console.error = (...args) => { originalError(...args); report('error', args.map((a) => a instanceof Error ? a.stack || a.message : typeof a === 'object' ? JSON.stringify(a) : a).join(' ')); };
    addEventListener('error', (event) => report('error', event.error?.stack || event.message));
    addEventListener('unhandledrejection', (event) => report('error', event.reason?.stack || event.reason));
    (async () => {
      let adapter = 'none';
      try { const a = await navigator.gpu?.requestAdapter(); adapter = a ? (a.info ? [a.info.vendor, a.info.architecture].filter(Boolean).join(' ') || 'yes' : 'yes') : 'null'; } catch (e) { adapter = 'error ' + e.message; }
      report('env', 'webgpu=' + !!navigator.gpu + ' adapter=' + adapter + ' jspi=' + (typeof WebAssembly.Suspending === 'function') + ' secure=' + isSecureContext);
    })();
    const app = document.getElementById('app');
    const status = document.getElementById('status');
    if (app) {
      const started = Date.now();
      const watch = new MutationObserver(() => {
        if (status?.textContent) { report('failed', status.textContent); shown(); watch.disconnect(); return; }
        const windows = app.querySelectorAll('canvas').length;
        if (windows) {
          report('started', windows + ' window(s) after ' + ((Date.now() - started) / 1000).toFixed(1) + 's');
          watch.disconnect();
          sampleFrame();
        }
      });
      watch.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    // A window canvas existing is not the app drawing: copy the first
    // window's frame into a small 2D canvas and count its colours. A WebGPU
    // canvas can only be copied in the frame that drew it (afterwards it
    // reads as transparent), so this samples from a frame callback queued
    // behind the app's, every frame, until one has content or 10 s pass.
    // One or two colours is a blank (cleared) window.
    function sampleFrame() {
      const source = app.querySelector('canvas');
      const probe = document.createElement('canvas');
      probe.width = 64; probe.height = 64;
      const context = probe.getContext('2d', { willReadFrequently: true });
      const until = performance.now() + 10000;
      let frames = 0;
      const sample = () => {
        frames++;
        let colours;
        try {
          context.clearRect(0, 0, 64, 64);
          context.drawImage(source, 0, 0, 64, 64);
          const pixels = context.getImageData(0, 0, 64, 64).data;
          colours = new Set();
          for (let i = 0; i < pixels.length; i += 4) colours.add(pixels[i] << 24 | pixels[i + 1] << 16 | pixels[i + 2] << 8 | pixels[i + 3]);
        } catch (e) {
          report('error', 'could not sample the frame: ' + e.message);
          return;
        }
        const text = colours.size + ' colours in a 64×64 sample of ' + source.width + '×' + source.height + ' (frame ' + frames + ')';
        if (colours.size > 2) { report('rendered', text); shown(); }
        else if (performance.now() > until) { report('blank', text); shown(); }
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(() => requestAnimationFrame(sample));
    }
    // In the panel, the panel does the reloading (see panelHTML): it loads
    // the new page behind this one and drops this one once that has drawn.
    const framed = window.parent !== window;
    function shown() { if (framed) parent.postMessage({ nucleantPreview: 'shown' }, '*'); }
    const events = new EventSource('${EVENTS_PATH}');
    let first = true;
    events.addEventListener('reload', () => framed ? parent.postMessage({ nucleantPreview: 'reload' }, '*') : location.reload());
    events.addEventListener('state', (event) => {
      const next = JSON.parse(event.data);
      // The state replayed on connecting is old news unless a build is on
      // or failed; a finished build's note is only worth showing live.
      if (first && next.kind === 'ready') next.step = undefined;
      first = false;
      state = next;
      render();
    });
    events.onerror = () => { if (events.readyState === EventSource.CLOSED || state.kind !== 'offline') { state = { kind: 'offline' }; render(); } };
    events.onopen = () => { if (state.kind === 'offline') { state = { kind: 'idle' }; render(); } };
  })();
</script>`;
    return page.includes('</body>') ? page.replace('</body>', `${script}\n</body>`) : page + script;
}

function placeholderPage(product) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${product}</title>
<style>:root{color-scheme:light dark}html,body{margin:0;height:100%;display:grid;place-items:center;font:14px system-ui,sans-serif;background:light-dark(#e2e2e8,#16161a);color:light-dark(#222,#ddd)}</style>
</head><body><p>Waiting for the first build of ${product}…</p></body></html>`;
}

/**
 * The panel: the served page in a frame filling it. The page asks the panel
 * to reload it. Previews keep the last frame on screen meanwhile: the new
 * page loads in a second frame underneath, which replaces the old one once
 * it has drawn (or failed, or after 20 s), so a reload doesn't flash black.
 * The app is reloaded in place, as before.
 */
function panelHTML(url, keepLastFrame) {
    const origin = new URL(url).origin;
    const nonce = crypto.randomBytes(16).toString('base64');
    return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>html,body{margin:0;padding:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block;position:absolute;inset:0;z-index:1}iframe.next{z-index:0}</style>
</head><body><iframe src="${url}" allow="webgpu; cross-origin-isolated; clipboard-read; clipboard-write"></iframe>
<script nonce="${nonce}">
  (() => {
    const keepLastFrame = ${keepLastFrame};
    let current = document.querySelector('iframe');
    let next, timer;
    const swap = () => {
      clearTimeout(timer);
      // Only if the panel has the keyboard: an unfocused panel keeps its
      // active element, and focusing a frame would take it from the editor.
      const focused = document.hasFocus() && document.activeElement === current;
      current.remove();
      current = next;
      next = undefined;
      current.classList.remove('next');
      if (focused) current.focus();
    };
    addEventListener('message', (event) => {
      const message = event.data?.nucleantPreview;
      if (message === 'reload' && event.source === current.contentWindow) {
        if (!keepLastFrame) { current.src = ${JSON.stringify(url)}; return; }
        // A reload while one is loading starts over with the newest build.
        next?.remove();
        clearTimeout(timer);
        next = current.cloneNode();
        next.className = 'next';
        document.body.prepend(next);
        timer = setTimeout(swap, 20000);
      } else if (message === 'shown' && next && event.source === next.contentWindow) {
        swap();
      }
    });
  })();
</script></body></html>`;
}

module.exports = { activate, deactivate };
