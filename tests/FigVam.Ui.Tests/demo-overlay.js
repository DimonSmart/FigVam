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
          host.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);' +
            'width:min(620px,calc(100vw - 32px));z-index:2147483647;pointer-events:none;';
          document.documentElement.appendChild(host);
          host.attachShadow({ mode: 'open' }).innerHTML = [
            '<style>',
            '.panel{box-sizing:border-box;padding:16px 20px 14px;border-radius:12px;',
            'background:rgba(16,23,37,.94);color:#fff;box-shadow:0 12px 40px #0005;',
            'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;',
            'border:1px solid #ffffff30;text-align:left;}',
            '.top{display:flex;justify-content:space-between;align-items:center;',
            'font-size:12px;color:#b7c7de;margin-bottom:7px;}',
            '.title{font-size:19px;font-weight:650;line-height:1.35;}',
            '.description{font-size:13px;line-height:1.45;color:#d0dbea;margin-top:5px;}',
            '.track{height:4px;border-radius:6px;background:#ffffff25;margin-top:13px;',
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
