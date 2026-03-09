import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { WorkspaceDirectoryWatcher } from '../dist/workspace-directory-watcher.js';

function waitFor(condition, timeoutMs = 2500) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('Timed out waiting for watcher event'));
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

test('workspace watcher emits for create and delete in nested directories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nion-workspace-watch-'));
  const events = [];
  const watcher = new WorkspaceDirectoryWatcher({
    rootPath: root,
    onChange(event) {
      events.push(event);
    },
  });

  await watcher.start();

  const nestedDir = path.join(root, 'notes');
  await fs.mkdir(nestedDir);
  await waitFor(() => events.length > 0);

  const filePath = path.join(nestedDir, 'todo.txt');
  await fs.writeFile(filePath, 'hello', 'utf8');
  await waitFor(() => events.some((event) => event.path === filePath));

  await fs.rm(filePath);
  await waitFor(() => events.some((event) => event.type === 'rename' && event.path === filePath));

  await watcher.close();

  assert.ok(events.length >= 3);
});
