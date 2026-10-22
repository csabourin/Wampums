/*
 * Blog articles (content/blog/) as the public site shows them.
 */
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

// marked is ESM-only, which Jest cannot load: headings are all this test needs from it.
jest.mock('marked', () => {
  const marked = (markdown) => markdown.split('\n').map((line) => {
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    return heading ? `<h${heading[1].length}>${heading[2]}</h${heading[1].length}>` : line;
  }).join('\n');
  marked.Renderer = function Renderer() {};
  marked.setOptions = () => {};
  return { marked };
});
jest.spyOn(fs, 'watch').mockReturnValue({ close: () => {} });
const blog = require('../services/blog');

const renderPost = (post) => ejs.renderFile(path.join(__dirname, '..', 'views', 'blog', 'post.ejs'), {
  post, prev: null, next: null, alternatePost: null, canonicalPath: '/', enPath: '/en/blog/', frPath: '/fr/blogue/',
});

test.each(blog.getAllPosts())('$lang article $slug has a title shorter than 70 characters including the brand', async (post) => {
  const html = await renderPost(post);
  const title = `${post.title} — Wampums`;
  expect(html).toContain(`<title>${ejs.escapeXML(title)}</title>`);
  expect(title.length).toBeLessThan(70);
});

test('every published article has a unique title', () => {
  const titles = blog.getAllPosts().map((post) => post.title.trim());
  expect(new Set(titles).size).toBe(titles.length);
});

test.each(blog.getAllPosts())('$lang article $slug has a meta description between 25 and 160 characters', async (post) => {
  const html = await renderPost(post);
  const description = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(html)[1].trim();
  expect(description.length).toBeGreaterThanOrEqual(25);
  expect(description.length).toBeLessThanOrEqual(160);
});

test('every published article shows its title once, as the page heading', async () => {
  const posts = blog.getAllPosts();
  expect(posts.length).toBeGreaterThan(0);

  const pages = await Promise.all(posts.map(renderPost));

  pages.forEach((html, index) => {
    expect(posts[index].content).not.toMatch(/<h1/);
    expect(html.match(/<h1/g)).toHaveLength(1);
  });
});
