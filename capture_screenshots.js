const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

function waitForPage(port, retries = 25) {
  return new Promise(async (resolve, reject) => {
    for (let i = 0; i < retries; i++) {
      try {
        const data = await new Promise((resOk, resErr) => {
          const req = http.get(`http://127.0.0.1:${port}/json`, (res) => {
            let b = '';
            res.on('data', c => b += c);
            res.on('end', () => resOk(b));
          });
          req.on('error', resErr);
          req.setTimeout(800, () => req.destroy());
        });
        const list = JSON.parse(data);
        const page = list.find(p => p.type === 'page');
        if (page) return resolve(page);
      } catch (e) {
        await new Promise(r => setTimeout(r, 250));
      }
    }
    reject(new Error(`Timeout waiting for page target on port ${port}`));
  });
}

function runEdgeSession(url, width, height, isMobile, outputPath, evalJs = null) {
  return new Promise(async (resolve, reject) => {
    const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const port = 9400 + Math.floor(Math.random() * 400);
    const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-prof-'));

    const proc = spawn(edgePath, [
      '--headless=new',
      '--disable-gpu',
      `--user-data-dir=${tempProfile}`,
      `--remote-debugging-port=${port}`,
      `--window-size=${width},${height}`,
      url
    ]);

    const cleanup = () => {
      try { proc.kill(); } catch (e) {}
      try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (e) {}
    };

    try {
      const page = await waitForPage(port);
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      let msgId = 1;

      const send = (method, params = {}) => {
        return new Promise((resOk) => {
          const id = msgId++;
          const handler = (ev) => {
            const m = JSON.parse(ev.data);
            if (m.id === id) {
              ws.removeEventListener('message', handler);
              resOk(m.result);
            }
          };
          ws.addEventListener('message', handler);
          ws.send(JSON.stringify({ id, method, params }));
        });
      };

      ws.onopen = async () => {
        try {
          await send('Emulation.setDeviceMetricsOverride', {
            width: width,
            height: height,
            deviceScaleFactor: 1,
            mobile: isMobile
          });

          await new Promise(r => setTimeout(r, 1200));

          if (evalJs) {
            await send('Runtime.evaluate', { expression: evalJs });
            await new Promise(r => setTimeout(r, 600));
          }

          const result = await send('Page.captureScreenshot', {
            format: 'png',
            clip: {
              x: 0,
              y: 0,
              width: width,
              height: height,
              scale: 1
            }
          });

          if (result && result.data) {
            fs.writeFileSync(outputPath, Buffer.from(result.data, 'base64'));
            console.log(`Saved screenshot to ${outputPath}`);
          }

          ws.close();
          cleanup();
          resolve();
        } catch (e) {
          ws.close();
          cleanup();
          reject(e);
        }
      };
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

async function main() {
  const screenshotsDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

  console.log('6. Capturing Phase 3 Mobile Notification Bottom Sheet (360px)...');
  await runEdgeSession(
    'http://localhost:3000/',
    360,
    780,
    true,
    path.join(screenshotsDir, 'phase3-notif-mobile-360.png'),
    `document.getElementById('notificationBell')?.click()`
  );

  console.log('All Phase 3 screenshots captured successfully!');
}

main().catch(console.error);
