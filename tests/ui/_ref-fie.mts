import { chromium, devices } from 'playwright';
const nav = await chromium.launch();
for (const [nombre, config] of [
  ['escritorio', { viewport: { width: 1440, height: 1000 } }],
  ['iphone', devices['iPhone 14 Pro']],
] as const) {
  const ctx = await nav.newContext({ ...config, locale: 'en-US' });
  const p = await ctx.newPage();
  try {
    await p.goto('https://fie.org/events', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForTimeout(4000);
    for (const t of ['Deny', 'Reject', 'Allow all']) {
      const b = p.getByRole('button', { name: t, exact: false });
      if (await b.count()) { await b.first().click({ timeout: 4000 }).catch(() => {}); break; }
    }
    await p.waitForTimeout(5000);
    await p.screenshot({ path: `capturas/ref-fie-lista-${nombre}.png` });
    const hrefs = await p.locator('a').evaluateAll((ns) =>
      ns.map((n) => (n as HTMLAnchorElement).getAttribute('href') ?? '')
        .filter((h) => /\/(events|competitions|tournaments)\/[^/]+/.test(h)),
    );
    console.log(`${nombre}: ${hrefs.length} -> ${[...new Set(hrefs)].slice(0, 6).join(' | ')}`);
    const destino = [...new Set(hrefs)][0];
    if (destino) {
      await p.goto(new URL(destino, 'https://fie.org').toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
      await p.waitForTimeout(8000);
      await p.screenshot({ path: `capturas/ref-fie-torneo-${nombre}.png` });
      console.log(`${nombre}: ${p.url()}`);
    }
  } catch (e) {
    console.log(`${nombre}: FALLO ${(e as Error).message.slice(0, 160)}`);
  }
  await ctx.close();
}
await nav.close();
