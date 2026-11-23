const HOST_ID = 'figvam-e2e-demo-overlay';

function createDemo(page, totalSteps, options = {}) {
  const enabled = options.enabled ?? (process.env.FIGVAM_DEMO === '1');
  const stepDelayMs = Number(options.stepDelayMs ?? process.env.FIGVAM_STEP_DELAY_MS ?? 2000);
  if (!Number.isInteger(totalSteps) || totalSteps < 1)
    throw new Error('totalSteps must be a positive integer');
  if (!Number.isInteger(stepDelayMs) || stepDelayMs < 0)
    throw new Error('FIGVAM_STEP_DELAY_MS must be a non-negative integer');

  let current = 0;
  return {
    async step(title, description = '', targetPage = page) {
      if (!enabled) return;
      current++;
      if (current > totalSteps) throw new Error('Demo step count exceeds totalSteps');

      await targetPage.evaluate(({ hostId, title, description, current, totalSteps }) => {
        let host = document.getElementById(hostId);
        if (!host) {
          host = document.createElement('div');
          host.id = hostId;
          host.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);' +
            'width:min(480px,calc(100vw - 24px));z-index:2147483647;pointer-events:none;';
          // Mount last in body so the panel remains above the editor without modifying its layout.
          (document.body ?? document.documentElement).appendChild(host);
          host.attachShadow({ mode: 'open' }).innerHTML = [
            '<style>',
            '.panel,.panel *{box-sizing:border-box;margin:0;}',
            '.panel{padding:9px 13px 8px;border-radius:9px;',
            'background:rgba(12,18,30,.92);color:#fff;box-shadow:0 8px 28px #0008;',
            'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;',
            'border:1px solid #ffffff40;text-align:left;line-height:1.2;',
            'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);}',
            '.top{display:flex;justify-content:space-between;align-items:center;',
            'font-size:10px;line-height:1.1;color:#d4dceb;margin-bottom:4px;}',
            '.title{font-size:15px;font-weight:600;line-height:1.2;}',
            '.description{font-size:12px;line-height:1.25;color:#e1e8f2;margin-top:3px;}',
            '.track{height:3px;border-radius:4px;background:#ffffff25;margin-top:7px;',
            'overflow:hidden}.progress{height:100%;background:#70a8ff;}',
            '</style>',
            '<section class="panel" role="status" aria-live="polite">',
            '<div class="top"><span>FigVam · UI demo</span><span class="counter"></span></div>',
            '<div class="title"></div><div class="description"></div>',
            '<div class="track"><div class="progress"></div></div>',
            '</section>'
          ].join('');
        }
        const shadow = host.shadowRoot;
        shadow.querySelector('.counter').textContent = 'Шаг ' + current + ' из ' + totalSteps;
        shadow.querySelector('.title').textContent = title;
        const details = shadow.querySelector('.description');
        details.textContent = description;
        details.hidden = !description;
        shadow.querySelector('.progress').style.width =
          String(Math.round(100 * current / totalSteps)) + '%';
      }, { hostId: HOST_ID, title, description, current, totalSteps });

      // Only presentation mode waits. Ordinary CI runs have no extra delays.
      if (stepDelayMs) await targetPage.waitForTimeout(stepDelayMs);
    }
  };
}

module.exports = { createDemo, HOST_ID };
