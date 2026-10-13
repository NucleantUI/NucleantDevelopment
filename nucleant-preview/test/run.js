#!/usr/bin/env node
// Opens a real VS Code — its own profile, so it runs beside your editor —
// with this extension loaded from source, and runs suite.js in it on one
// Swift file:
//
//   node test/run.js NucleantUI/Examples/Pomodoro/Sources/Pomodoro/PomodoroApp.swift [app|previews]
//
// $VSCODE overrides the VS Code executable. The result is printed and kept
// in .test/result.json.

'use strict';

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const extension = path.resolve(__dirname, '..');
const workspace = path.dirname(extension);
const file = path.resolve(process.argv[2] ?? path.join(workspace, 'NucleantUI/Examples/Pomodoro/Sources/Pomodoro/PomodoroApp.swift'));
const scratch = path.join(extension, '.test');
const resultFile = path.join(scratch, 'result.json');
const code = process.env.VSCODE ?? '/Applications/Visual Studio Code.app/Contents/MacOS/Code';

// Started from inside VS Code (its terminal, an extension), this is set and
// would make the executable a plain Node.
const env = { ...process.env, NUCLEANT_PREVIEW_FILE: file, NUCLEANT_PREVIEW_RESULT: resultFile, NUCLEANT_PREVIEW_MODE: process.argv[3] ?? 'app' };
delete env.ELECTRON_RUN_AS_NODE;

fs.mkdirSync(scratch, { recursive: true });
fs.rmSync(resultFile, { force: true });
const child = cp.spawn(code, [
    workspace,
    // Short: VS Code's IPC socket lives in it, and its path must stay
    // under 104 bytes.
    `--user-data-dir=${path.join(os.tmpdir(), 'nucleant-preview-vscode')}`,
    `--extensions-dir=${path.join(scratch, 'extensions')}`,
    `--extensionDevelopmentPath=${extension}`,
    `--extensionTestsPath=${path.join(__dirname, 'suite.js')}`,
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--new-window',
], { env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (d) => process.stdout.write(d));
child.stderr.on('data', (d) => process.stderr.write(d));
child.on('exit', (status) => {
    if (fs.existsSync(resultFile)) console.log(fs.readFileSync(resultFile, 'utf8'));
    process.exit(status ?? 1);
});
