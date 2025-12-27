/**
 * SimpleWYSIWYG - A lightweight WYSIWYG editor component
 * Provides basic formatting: bold, italic, bullet lists, numbered lists
 */

import { translate } from "../app.js";
import { escapeHTML } from "./SecurityUtils.js";
import { setContent } from "./DOMUtils.js";

export class SimpleWYSIWYG {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      placeholder: options.placeholder || translate("activity_description_label"),
      initialContent: options.initialContent || "",
      maxLength: options.maxLength || 5000,
      onChange: options.onChange || null,
      ...options
    };
    this.editor = null;
    this.toolbar = null;
    this.init();
  }

  init() {
    // Clear container
    setContent(this.container, "");
    this.container.classList.add("wysiwyg-container");

    // Create toolbar
    this.createToolbar();

    // Create editor
    this.createEditor();

    // Attach event handlers
    this.attachEventHandlers();
  }

  createToolbar() {
    this.toolbar = document.createElement("div");
    this.toolbar.className = "wysiwyg-toolbar";

    const buttons = [
      { command: "bold", icon: "B", title: "Gras (Ctrl+B)" },
      { command: "italic", icon: "I", title: "Italique (Ctrl+I)" },
      { command: "insertUnorderedList", icon: "•", title: "Liste à puces" },
      { command: "insertOrderedList", icon: "1.", title: "Liste numérotée" }
    ];

    buttons.forEach(({ command, icon, title }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wysiwyg-btn";
      setContent(button, icon);
      button.title = title;
      button.setAttribute("data-command", command);
      this.toolbar.appendChild(button);
    });

    this.container.appendChild(this.toolbar);
  }

  createEditor() {
    this.editor = document.createElement("div");
    this.editor.className = "wysiwyg-editor";
    this.editor.contentEditable = true;
    this.editor.setAttribute("role", "textbox");
    this.editor.setAttribute("aria-multiline", "true");
    this.editor.setAttribute("aria-label", this.options.placeholder);

    if (this.options.initialContent) {
      setContent(this.editor, this.options.initialContent);
    } else {
      this.editor.setAttribute("data-placeholder", this.options.placeholder);
    }

    this.container.appendChild(this.editor);
  }

  attachEventHandlers() {
    // Handle toolbar button clicks
    this.toolbar.querySelectorAll(".wysiwyg-btn").forEach(button => {
      button.addEventListener("click", (e) => {
        e.preventDefault();
        const command = button.getAttribute("data-command");
        this.execCommand(command);
      });
    });

    // Handle content changes
    this.editor.addEventListener("input", () => {
      this.updatePlaceholder();
      this.enforceMaxLength();
      if (this.options.onChange) {
        this.options.onChange(this.getHTML());
      }
    });

    // Handle paste - strip formatting
    this.editor.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      document.execCommand("insertText", false, text);
    });

    // Update placeholder on focus/blur
    this.editor.addEventListener("focus", () => this.updatePlaceholder());
    this.editor.addEventListener("blur", () => this.updatePlaceholder());
  }

  execCommand(command) {
    document.execCommand(command, false, null);
    this.editor.focus();
    if (this.options.onChange) {
      this.options.onChange(this.getHTML());
    }
  }

  updatePlaceholder() {
    if (this.editor.textContent.trim() === "") {
      this.editor.setAttribute("data-placeholder", this.options.placeholder);
    } else {
      this.editor.removeAttribute("data-placeholder");
    }
  }

  enforceMaxLength() {
    const text = this.editor.textContent;
    if (text.length > this.options.maxLength) {
      // Truncate content
      const range = document.createRange();
      const selection = window.getSelection();

      // Save cursor position before truncation
      const cursorPos = Math.min(this.getCursorPosition(), this.options.maxLength);

      // Truncate
      this.editor.textContent = text.substring(0, this.options.maxLength);

      // Restore cursor
      this.setCursorPosition(cursorPos);
    }
  }

  getCursorPosition() {
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return 0;
    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(this.editor);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    return preCaretRange.toString().length;
  }

  setCursorPosition(pos) {
    const textNode = this.editor.firstChild;
    if (!textNode) return;

    const range = document.createRange();
    const selection = window.getSelection();
    range.setStart(textNode, Math.min(pos, textNode.length));
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  getHTML() {
    return this.editor.innerHTML.trim();
  }

  getText() {
    return this.editor.textContent.trim();
  }

  setHTML(html) {
    setContent(this.editor, html);
    this.updatePlaceholder();
  }

  clear() {
    setContent(this.editor, "");
    this.updatePlaceholder();
  }

  focus() {
    this.editor.focus();
  }

  destroy() {
    setContent(this.container, "");
  }
}

// Add CSS styles for WYSIWYG editor (if not already in main CSS)
export function injectWYSIWYGStyles() {
  if (document.getElementById("wysiwyg-styles")) return;

  const style = document.createElement("style");
  style.id = "wysiwyg-styles";
  style.textContent = `
    .wysiwyg-container {
      border: 1px solid #ccc;
      border-radius: 4px;
      background: white;
      overflow: hidden;
    }

    .wysiwyg-toolbar {
      display: flex;
      gap: 4px;
      padding: 8px;
      background: #f5f5f5;
      border-bottom: 1px solid #ccc;
    }

    .wysiwyg-btn {
      padding: 6px 12px;
      border: 1px solid #ccc;
      background: white;
      cursor: pointer;
      font-weight: bold;
      font-size: 14px;
      border-radius: 3px;
      transition: background 0.2s;
    }

    .wysiwyg-btn:hover {
      background: #e8e8e8;
    }

    .wysiwyg-btn:active {
      background: #d8d8d8;
    }

    .wysiwyg-editor {
      min-height: 150px;
      max-height: 400px;
      padding: 12px;
      overflow-y: auto;
      outline: none;
      font-size: 14px;
      line-height: 1.6;
    }

    .wysiwyg-editor[data-placeholder]:empty:before {
      content: attr(data-placeholder);
      color: #999;
      font-style: italic;
    }

    .wysiwyg-editor b,
    .wysiwyg-editor strong {
      font-weight: bold;
    }

    .wysiwyg-editor i,
    .wysiwyg-editor em {
      font-style: italic;
    }

    .wysiwyg-editor ul,
    .wysiwyg-editor ol {
      margin: 8px 0;
      padding-left: 24px;
    }

    .wysiwyg-editor li {
      margin: 4px 0;
    }
  `;
  document.head.appendChild(style);
}
