import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { MESSAGE_IDS } from '../../../packages/i18n/src/message-ids.ts';

export async function journey({ db, context, member, phase, locale, width, output }) {
  const before = phase === 'before';
  const messages = JSON.parse(await readFile(new URL(`../../../packages/i18n/messages/${locale}.json`, import.meta.url), 'utf8'));
  const t = (key) => messages[MESSAGE_IDS[key]];
  const suffix = randomUUID().slice(0, 8);
  const project = await db.project.create({
    data: {
      organizationId: member.organizationId,
      name: 'Authoring QA',
      slug: `editor-p2-${suffix}`,
      config: { styling: { primaryColor: '#2563eb' }, addons: { previewDeployments: true } },
      branches: { create: { name: 'main', isDefault: true } },
      languages: {
        create: { code: locale, label: locale === 'ar' ? 'العربية' : 'English', isDefault: true, direction: locale === 'ar' ? 'RTL' : 'LTR' },
      },
    },
    include: { branches: true, languages: true },
  });
  const title = locale === 'ar' ? '\u0627\u0644\u0628\u062f\u0621 \u0627\u0644\u0633\u0631\u064a\u0639' : 'Quickstart';
  const seed = await db.page.create({
    data: {
      projectId: project.id,
      branchId: project.branches[0].id,
      languageId: project.languages[0].id,
      title,
      slug: 'quickstart',
      path: 'quickstart',
      content: '# Welcome\n\nA fictional documentation page.',
      position: 1,
    },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const frames = [];
  const record = async (name, target = page) => {
    const file = `${phase}-${locale}-${width}-${name}.png`;
    await target.evaluate(() => document.fonts.ready);
    await target.waitForTimeout(350); // Keep each checkpoint legible in the recording.
    await target.screenshot({ path: resolve(output, file) });
    frames.push(file);
  };
  const editorUrl = `http://localhost:4310/app/projects/${project.id}/editor?page=${seed.id}`;
  await page.goto(editorUrl);
  await page.locator('[data-page-title]').waitFor();
  // Close the navigation drawer before measuring the canvas on a phone.
  const closeTree = page.getByRole('complementary').getByRole('button', { name: t('editor.hideSidebar'), exact: true });
  if (width === 390 && (await closeTree.isVisible())) await closeTree.click();
  const layout = await page.evaluate(() => ({
    titleTop: document.querySelector('[data-page-title]').getBoundingClientRect().top,
    viewport: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    headerWidth: document.querySelector('header').scrollWidth,
  }));
  if (!before) {
    assert.ok(layout.documentWidth <= width, 'editor fits the viewport');
    assert.ok(layout.headerWidth <= width, 'header actions fit without clipping');
  }
  await record('editor');

  const more = page.getByRole('button', { name: t('editor.pageActions').replace('{title}', title), exact: true }).filter({ visible: true });
  if (width === 390 && !before) {
    await more.click();
    const menu = page.getByRole('menu');
    const snapshot = await menu.ariaSnapshot();
    assert.match(snapshot, /menuitem/);
    await writeFile(resolve(output, `${phase}-${locale}-${width}-menu.txt`), snapshot);
    await record('menu');
    await page.getByRole('menuitem', { name: t('editor.pageSettings.title'), exact: true }).click();
  } else await page.getByRole('button', { name: t('editor.pageSettings.title'), exact: true }).click();
  const settings = page.getByRole('dialog');
  await record('settings-general');
  await settings.getByRole('button', { name: t('editor.pageSettings.more'), exact: true }).click();
  await settings.locator('#page-icon').fill('rocket');
  if (!before) {
    assert.equal(await settings.getByRole('spinbutton').count(), 0);
    assert.ok(await settings.locator('#page-language-reason').isVisible());
    await settings.locator('#page-icon').fill('not-an-icon');
    assert.equal(await settings.locator('#page-icon').getAttribute('aria-invalid'), 'true');
    await record('icon-validation');
    await settings.locator('#page-icon').fill('rocket');
  }
  await record('settings');
  await settings.getByRole('button', { name: t('editor.pageSettings.save'), exact: true }).click();
  await settings.waitFor({ state: 'hidden' });
  assert.equal((await db.page.findUniqueOrThrow({ where: { id: seed.id } })).icon, 'rocket');

  // Create the empty group through the editor, then return to Quickstart.
  const showPages = page.getByRole('button', { name: t(!before ? 'editor.showPages' : 'editor.showSidebar'), exact: true }).filter({ visible: true });
  if (width === 390) await showPages.click();
  await page.getByRole('button', { name: t('editor.newGroup'), exact: true }).click();
  const groupDialog = page.getByRole('dialog');
  await groupDialog.getByRole('textbox').fill('Guides');
  await groupDialog.getByRole('button', { name: t('editor.createGroup'), exact: true }).click();
  await groupDialog.waitFor({ state: 'hidden' });
  let group;
  for (let i = 0; i < 80; i++) {
    group = await db.page.findFirst({ where: { projectId: project.id, kind: 'GROUP' } });
    if (group) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(group, 'group creation persisted');
  await db.page.update({ where: { id: group.id }, data: { position: 0 } });
  await page.reload();
  await page.locator('[data-page-title]').waitFor();
  if (width === 390 && !(await closeTree.isVisible())) await showPages.click();
  const groupLabel = page.locator(`[data-page-id="${group.id}"]`).getByRole('button', { name: 'Guides', exact: true });
  if (!before) assert.equal(await groupLabel.evaluate((element) => getComputedStyle(element).textTransform), 'none');
  await record('group-tree');
  if (width === 390) await closeTree.click();

  // Preview uses the actual popup from the editor, then publishes from its own chrome.
  const popup = context.waitForEvent('page');
  if (width === 390 && !before) {
    await more.click();
    await page.getByRole('menuitem', { name: t('project.preview'), exact: true }).click();
  } else {
    await page.getByRole('button', { name: t('project.preview'), exact: true }).click();
  }
  const preview = await popup;
  await preview.waitForLoadState();
  const publish = preview.getByRole('button', { name: t('project.publish'), exact: true });
  await publish.waitFor();
  const colour = await publish.evaluate((element) => getComputedStyle(element).backgroundColor);
  if (!before) assert.notEqual(colour, 'rgb(37, 99, 235)', 'preview chrome uses app tokens');
  await record('preview', preview);
  await publish.click();
  const publishDialog = preview.getByRole('dialog');
  await publishDialog.waitFor();
  await publishDialog.getByRole('button', { name: t('publish.now'), exact: true }).waitFor();
  const pending = await context.request.get(`http://localhost:4310/api/app/projects/${project.id}/deployments/changes`);
  const diff = (await pending.json()).data;
  assert.equal(
    diff.changes.some((change) => change.kind === 'GROUP'),
    before,
  );
  await record('publish-diff', preview);
  await publishDialog.getByRole('button', { name: t('publish.now'), exact: true }).click();
  let deployment;
  for (let i = 0; i < 120; i++) {
    deployment = await db.deployment.findFirst({ where: { projectId: project.id }, orderBy: { version: 'desc' } });
    if (deployment?.status === 'READY') break;
    if (deployment?.status === 'FAILED') throw new Error(`Publish failed: ${deployment.error}`);
    await new Promise((done) => setTimeout(done, 500));
  }
  assert.equal(deployment?.status, 'READY');
  await preview.goto(`http://localhost:4310/sites/${project.id}/quickstart`);
  await preview.locator('article').waitFor();
  if (width === 390) {
    await preview.getByRole('button', { name: t('site.openMenu'), exact: true }).click();
  }
  const nav = preview.locator('[data-site-nav]').filter({ visible: true });
  await nav.first().waitFor();
  assert.equal((await nav.first().innerText()).includes('Guides'), before);
  assert.equal((await context.request.get(`http://localhost:4310/sites/${project.id}/guides`)).status(), 404);
  await record('published-sidebar', preview);
  await preview.close();
  const previewVideo = basename(await preview.video().path());

  // An empty title is presentation-only; reload and the database agree with the tree.
  await page.goto(editorUrl);
  await page.locator('[data-page-title]').waitFor();
  if (width === 390 && !(await closeTree.isVisible())) await showPages.click();
  await page.getByRole('button', { name: t('editor.newPage'), exact: true }).click();
  await page.locator('[data-page-title]').waitFor();
  let created;
  for (let i = 0; i < 40; i++) {
    created = await db.page.findFirst({ where: { projectId: project.id, slug: 'untitled' } });
    if (created) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(created);
  assert.equal(created.title, before ? t('editor.untitled') : '');
  if (!before) assert.equal(await page.locator('[data-page-title]').inputValue(), '');
  if (!before && width === 390) {
    // Creating from the drawer closes it, so the focused title is visible: never
    // closed by hand here, which would hide the regression.
    await closeTree.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('[data-page-title]').evaluate((element) => element === document.activeElement), true);
  }
  await record('new-page');
  if (width === 390 && !(await closeTree.isVisible())) await showPages.click();
  const createdRow = page.locator(`[data-page-id="${created.id}"]`);
  if (!before) {
    assert.equal(await createdRow.locator('.bg-warning[aria-hidden="true"]').count(), 1);
    assert.equal(await createdRow.getByRole('button', { name: t('editor.untitled'), exact: true }).count(), 1);
  }
  await record('untitled-tree');
  if (width === 390) await closeTree.click();
  await page.locator('[data-page-title]').fill(`${title} 2`);
  await page.locator('.ProseMirror').click();
  for (let i = 0; i < 80; i++) {
    created = await db.page.findUniqueOrThrow({ where: { id: created.id } });
    if (created.title === `${title} 2` && created.slug !== 'untitled') break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.equal(created.title, `${title} 2`);
  assert.notEqual(created.slug, 'untitled');
  await record('named-page');

  // Keyboard language selection exercises the real combobox and API write.
  // Use a second, English-only site so Arabic is available in either UI locale.
  const languageSite = await db.project.create({
    data: {
      organizationId: member.organizationId,
      name: 'Language QA',
      slug: `language-p2-${suffix}`,
      branches: { create: { name: 'main', isDefault: true } },
      languages: { create: { code: 'en', label: 'English', isDefault: true, direction: 'LTR' } },
    },
    include: { branches: true, languages: true },
  });
  const languagePage = await db.page.create({
    data: {
      projectId: languageSite.id,
      branchId: languageSite.branches[0].id,
      languageId: languageSite.languages[0].id,
      title: 'Quickstart',
      slug: 'quickstart',
      path: 'quickstart',
      position: 0,
    },
  });
  await page.goto(`http://localhost:4310/app/projects/${languageSite.id}/editor?page=${languagePage.id}`);
  await page.locator('[data-page-title]').waitFor();
  if (width === 390) await showPages.click();
  await page.getByRole('button', { name: t('editor.addLanguage'), exact: true }).click();
  const languageDialog = page.getByRole('dialog');
  const combo = languageDialog.getByRole('combobox');
  await combo.fill('Arab');
  const snapshot = await languageDialog.ariaSnapshot();
  await writeFile(resolve(output, `${phase}-${locale}-${width}-language.txt`), snapshot);
  if (!before) {
    assert.equal(await languageDialog.getByRole('option').count(), 1);
    assert.ok(snapshot.includes('option'));
    assert.ok(!snapshot.includes('Brasil'));
    const active = await combo.getAttribute('aria-activedescendant');
    assert.ok(active && (await languageDialog.locator(`[id="${active}"][aria-selected="true"]`).count()));
  }
  await record('language');
  await combo.press('ArrowDown');
  await page.waitForTimeout(300);
  await combo.press('ArrowUp');
  await page.waitForTimeout(300);
  await combo.press('Enter');
  await languageDialog.waitFor({ state: 'hidden' });
  assert.ok(await db.language.findFirst({ where: { projectId: languageSite.id, code: 'ar' } }));
  await page.close();
  const editorVideo = basename(await page.video().path());
  console.log(`Passed ${phase} ${locale} ${width}`);
  return {
    phase,
    locale,
    width,
    layout,
    previewPublishColour: colour,
    projectId: project.id,
    frames,
    videos: { editor: editorVideo, preview: previewVideo },
  };
}
