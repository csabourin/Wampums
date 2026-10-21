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

test('every published article shows its title once, as the page heading', async () => {
  const posts = blog.getAllPosts();
  expect(posts.length).toBeGreaterThan(0);

  const pages = await Promise.all(posts.map((post) => ejs.renderFile(path.join(__dirname, '..', 'views', 'blog', 'post.ejs'), {
    post, prev: null, next: null, alternatePost: null, canonicalPath: '/', enPath: '/en/blog/', frPath: '/fr/blogue/',
  })));

  pages.forEach((html, index) => {
    expect(posts[index].content).not.toMatch(/<h1/);
    expect(html.match(/<h1/g)).toHaveLength(1);
  });
});
