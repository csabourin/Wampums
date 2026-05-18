// One-shot script: wrap all unwrapped `async (req, res) => { ... }` handlers
// in router.METHOD(...) calls with `asyncHandler(...)`.
//
// Run with: NODE_PATH=/tmp/node_modules node scripts/wrap-async-handlers.js routes/forms.js
//
// Performs textual splices on the original source so formatting/comments are
// preserved. Idempotent: skips handlers already wrapped in asyncHandler(...).

const fs = require('node:fs');
const parser = require('@babel/parser');

const ROUTER_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'use']);

function findHandlers(ast) {
  const out = [];

  function walk(node, parent) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const c of node) walk(c, parent);
      return;
    }
    if (node.type === 'CallExpression') {
      const callee = node.callee;
      const isRouterCall =
        callee?.type === 'MemberExpression' &&
        callee.object?.type === 'Identifier' &&
        callee.object.name === 'router' &&
        callee.property?.type === 'Identifier' &&
        ROUTER_METHODS.has(callee.property.name);

      if (isRouterCall && node.arguments.length >= 2) {
        const last = node.arguments[node.arguments.length - 1];
        if (
          last?.type === 'ArrowFunctionExpression' &&
          last.async === true &&
          last.params.length >= 2
        ) {
          // Already wrapped?
          // (The arrow is the direct argument — if it were already wrapped, the
          // last argument would be a CallExpression to asyncHandler, not an arrow.)
          out.push({ start: last.start, end: last.end });
        }
        // Also handle `async function (req, res) { ... }` form
        if (
          last?.type === 'FunctionExpression' &&
          last.async === true &&
          last.params.length >= 2
        ) {
          out.push({ start: last.start, end: last.end });
        }
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'tokens') continue;
      walk(node[k], node);
    }
  }

  walk(ast.program ?? ast, null);
  return out;
}

function transform(src) {
  const ast = parser.parse(src, {
    sourceType: 'script',
    plugins: ['jsx'],
    ranges: true,
  });
  const handlers = findHandlers(ast).sort((a, b) => b.start - a.start);
  let out = src;
  let count = 0;
  for (const h of handlers) {
    const before = out.slice(0, h.start);
    const handler = out.slice(h.start, h.end);
    const after = out.slice(h.end);
    out = `${before}asyncHandler(${handler})${after}`;
    count += 1;
  }
  return { src: out, count };
}

function ensureAsyncHandlerImport(src) {
  // Look for an existing `require('../middleware/response')` destructure that
  // already pulls asyncHandler. If found, leave it alone. Otherwise, extend it.
  const requireRe = /const\s*\{([^}]*)\}\s*=\s*require\(['"]\.\.\/middleware\/response['"]\)/;
  const m = src.match(requireRe);
  if (m) {
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (names.some((n) => n.replace(/\s*:\s*\w+$/, '').trim() === 'asyncHandler')) {
      return src;
    }
    const newNames = [...names, 'asyncHandler'];
    return src.replace(requireRe, `const { ${newNames.join(', ')} } = require('../middleware/response')`);
  }

  // No middleware/response import yet — add one after the express import.
  const exprRe = /const\s+express\s*=\s*require\(['"]express['"]\)\s*;?\s*\n/;
  if (exprRe.test(src)) {
    return src.replace(
      exprRe,
      (match) => `${match}const { asyncHandler } = require('../middleware/response');\n`,
    );
  }

  // Last resort: prepend.
  return `const { asyncHandler } = require('../middleware/response');\n${src}`;
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: node scripts/wrap-async-handlers.js <file> [file...]');
    process.exit(2);
  }
  let total = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const withImport = ensureAsyncHandlerImport(src);
    const { src: wrapped, count } = transform(withImport);
    if (count === 0 && withImport === src) {
      console.log(`SKIP ${f} — nothing to wrap`);
      continue;
    }
    fs.writeFileSync(f, wrapped);
    total += count;
    console.log(`OK   ${f} — wrapped ${count} handlers`);
  }
  console.log(`Total handlers wrapped: ${total}`);
}

main();
