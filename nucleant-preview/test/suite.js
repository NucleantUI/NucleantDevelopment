// Runs inside a VS Code extension host (see run.js): opens a Swift file,
// runs the app or shows its previews beside it ($NUCLEANT_PREVIEW_MODE), and waits for the build and for the page in
// the panel to say whether the app came up and drew something, with no
// errors on the way. Writes what it saw to
// $NUCLEANT_PREVIEW_RESULT and fails if the build or the page did.

'use strict';

const vscode = require('vscode');
const fs = require('fs');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, seconds) {
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
        const value = predicate();
        if (value) return value;
        await wait(250);
    }
    return undefined;
}

exports.run = async () => {
    const file = process.env.NUCLEANT_PREVIEW_FILE;
    const result = { file };
    try {
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
        const extension = vscode.extensions.getExtension('nucleant.nucleant-preview');
        const api = await extension.activate();
        const mode = process.env.NUCLEANT_PREVIEW_MODE ?? 'app';
        result.mode = mode;
        await vscode.commands.executeCommand(mode === 'previews' ? 'nucleantPreview.showPreviews' : 'nucleantPreview.runApp');

        const session = await until(() => api.session, 120);
        if (!session) throw new Error('no preview session started');
        result.product = session.product;
        result.url = session.url;
        // A first wasm build of an example takes minutes.
        const state = await until(() => ['ready', 'failed'].includes(session.state.kind) && !session.building && session.state, 30 * 60);
        result.build = state ?? { kind: 'timeout' };
        if (state?.kind === 'ready') {
            // The panel (re)loads the page once the build lands.
            result.page = await until(() => session.reports.find((r) => ['rendered', 'blank', 'failed'].includes(r.kind)), 120) ?? { kind: 'no report from the page' };
            await wait(2000);
            // A reload as a build landing does it: the page asks the panel,
            // which loads it again (for previews, behind the old one).
            if (result.page.kind === 'rendered') {
                const before = session.reports.length;
                session.broadcast('reload', {});
                result.reload = await until(() => session.reports.slice(before).find((r) => ['rendered', 'blank', 'failed'].includes(r.kind)), 120) ?? { kind: 'no report after the reload' };
                await wait(2000);
            }
        }
        result.reports = session.reports;
    } catch (error) {
        result.error = error.stack || String(error);
    }
    fs.writeFileSync(process.env.NUCLEANT_PREVIEW_RESULT, JSON.stringify(result, null, 2));
    if (result.error || result.build?.kind !== 'ready' || result.page?.kind !== 'rendered' || result.reload?.kind !== 'rendered' || result.reports?.some((r) => r.kind === 'error')) {
        throw new Error(`preview did not come up: ${JSON.stringify({ build: result.build?.kind, page: result.page, reload: result.reload, error: result.error })}`);
    }
};
