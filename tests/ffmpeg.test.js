const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const express = require('express');

function loadStreamer(spawn) {
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../server/streamer.js'), 'utf8'),
    {
      module,
      console,
      require: (name) =>
        name === 'child_process'
          ? { spawn }
          : name === './utils'
            ? require('../server/utils')
            : require(name),
    }
  );
  return module.exports;
}

function processStub() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.kill = () => {
    child.killed = true;
    child.stdout.destroy();
    child.stderr.destroy();
  };
  return child;
}

async function fixture(t, streamer) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orangetv-ffmpeg-'));
  const file = path.join(root, 'sample.mp4');
  fs.writeFileSync(file, 'direct video');
  const app = express();
  app.get('/video', (req, res, next) =>
    streamer.streamVideoRemux(req, res, file).catch(next)
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return `http://127.0.0.1:${server.address().port}/video`;
}

test('caches concurrent FFmpeg availability checks and falls back to direct playback', async (t) => {
  let checks = 0;
  const streamer = loadStreamer(() => {
    checks++;
    const child = processStub();
    queueMicrotask(() => {
      child.emit(
        'error',
        Object.assign(new Error('Not installed'), { code: 'ENOENT' })
      );
      child.emit('close', -2);
    });
    return child;
  });
  assert.equal(streamer.checkFfmpeg(), streamer.checkFfmpeg());
  assert.equal(await streamer.checkFfmpeg(), false);
  const response = await fetch(await fixture(t, streamer));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'direct video');
  assert.equal(checks, 1);
});

test('remuxes with video copy and AAC audio and completes the response', async (t) => {
  let remuxArguments;
  const streamer = loadStreamer((_command, args) => {
    const child = processStub();
    if (!args.includes('-version')) remuxArguments = args;
    setImmediate(() => {
      if (remuxArguments && args === remuxArguments)
        child.stdout.end('fragmented mp4');
      else child.stdout.end();
      child.exitCode = 0;
      child.emit('close', 0);
    });
    return child;
  });
  const response = await fetch(await fixture(t, streamer));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('accept-ranges'), 'none');
  assert.equal(await response.text(), 'fragmented mp4');
  assert.equal(remuxArguments[remuxArguments.indexOf('-c:v') + 1], 'copy');
  assert.equal(remuxArguments[remuxArguments.indexOf('-c:a') + 1], 'aac');
});

test('returns an error when FFmpeg exits unsuccessfully or fails to spawn', async (t) => {
  for (const failure of ['exit', 'spawn']) {
    await t.test(failure, async (t) => {
      const streamer = loadStreamer((_command, args) => {
        const child = processStub();
        setImmediate(() => {
          if (args.includes('-version')) {
            child.exitCode = 0;
            child.emit('close', 0);
          } else if (failure === 'spawn') {
            child.emit('error', new Error('Spawn failed'));
          } else {
            child.stderr.end('Unsupported codec');
            child.stdout.end();
            child.exitCode = 1;
            child.emit('close', 1);
          }
        });
        return child;
      });
      const response = await fetch(await fixture(t, streamer));
      assert.equal(response.status, 500);
      assert.match((await response.json()).error, /Unable to read media/);
    });
  }
});

test('kills the remux process when the client disconnects', async (t) => {
  let remux;
  let killed;
  const stopped = new Promise((resolve) => {
    killed = resolve;
  });
  const streamer = loadStreamer((_command, args) => {
    const child = processStub();
    if (args.includes('-version')) {
      setImmediate(() => {
        child.exitCode = 0;
        child.emit('close', 0);
      });
    } else {
      remux = child;
      child.kill = () => {
        child.killed = true;
        child.stdout.destroy();
        killed();
      };
      setImmediate(() => child.stdout.write('video data'));
    }
    return child;
  });
  const url = await fixture(t, streamer);
  await new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.once('data', () => {
        response.destroy();
        resolve();
      });
    });
    request.on('error', reject);
  });
  await stopped;
  assert.equal(remux.killed, true);
});

test('terminates a partially written remux response when FFmpeg fails', async (t) => {
  const streamer = loadStreamer((_command, args) => {
    const child = processStub();
    setImmediate(() => {
      if (args.includes('-version')) {
        child.exitCode = 0;
        child.emit('close', 0);
        return;
      }
      child.stdout.write('partial video');
      setImmediate(() => {
        child.stderr.end('Remux interrupted');
        child.exitCode = 1;
        child.emit('close', 1);
      });
    });
    return child;
  });
  const url = await fixture(t, streamer);
  await assert.rejects(async () => {
    const response = await fetch(url);
    await response.text();
  });
});
