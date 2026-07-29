import { DOMParser } from "@xmldom/xmldom";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const forbiddenElements = new Set([
  "script",
  "foreignobject",
  "image",
  "style",
  "animate",
  "animatemotion",
  "animatetransform",
  "set",
  "discard",
  "mpath",
  "handler",
  "listener",
  "audio",
  "video",
  "iframe",
  "object",
  "embed",
  "link",
  "base",
  "canvas"
]);

const localFragment = /^#[A-Za-z_][A-Za-z0-9_.:-]*$/;
const localUrl = /url\s*\(\s*["']?(#[A-Za-z_][A-Za-z0-9_.:-]*)["']?\s*\)/gi;

const inspectResourceValue = (value, label, issues) => {
  if (/\\|\/\*/.test(value)) {
    issues.push(`${label}: obfuscated CSS resource syntax is forbidden`);
    return;
  }
  if (/\b(?:var|env|attr)\s*\(/i.test(value)) {
    issues.push(`${label}: dynamic CSS value syntax is forbidden`);
    return;
  }
  if (!/url\s*\(/i.test(value)) return;
  const matches = [...value.matchAll(localUrl)];
  const remainder = value.replace(localUrl, "").trim();
  if (remainder || matches.length === 0) issues.push(`${label}: only local fragment url(#id) references are allowed`);
};

export const inspectSvgSafety = (source, label = "SVG", { requireAccessibleRoot = false } = {}) => {
  const issues = [];
  if (typeof source !== "string" || source.length === 0) return [`${label}: SVG source must be non-empty text`];
  if (/\u0000/.test(source)) issues.push(`${label}: NUL bytes are forbidden`);
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) issues.push(`${label}: document/entity declarations are forbidden`);
  if (/<\?xml-stylesheet\b/i.test(source)) issues.push(`${label}: external stylesheet instructions are forbidden`);
  if (issues.length) return issues;

  let document;
  try {
    document = new DOMParser().parseFromString(source, "image/svg+xml");
  } catch (error) {
    return [`${label}: XML parse failed: ${error.message}`];
  }

  const root = document.documentElement;
  if (!root || String(root.localName).toLowerCase() !== "svg" || root.namespaceURI !== SVG_NAMESPACE) {
    issues.push(`${label}: root must be an SVG-namespace svg element`);
    return issues;
  }
  if (document.doctype) issues.push(`${label}: document type declarations are forbidden`);

  if (requireAccessibleRoot) {
    if (!root.hasAttribute("viewBox")) issues.push(`${label}: root is missing viewBox`);
    if (root.getAttribute("role") !== "img") issues.push(`${label}: root is missing role=img`);
    const accessibleName = root.getAttribute("aria-label") || root.getAttribute("aria-labelledby");
    if (!accessibleName?.trim()) issues.push(`${label}: root is missing an accessible name attribute`);
    const directChildren = Array.from({ length: root.childNodes.length }, (_, index) => root.childNodes.item(index));
    if (!directChildren.some((child) => child.nodeType === 1 && child.namespaceURI === SVG_NAMESPACE && String(child.localName).toLowerCase() === "title")) {
      issues.push(`${label}: root is missing a direct title child`);
    }
    if (!directChildren.some((child) => child.nodeType === 1 && child.namespaceURI === SVG_NAMESPACE && String(child.localName).toLowerCase() === "desc")) {
      issues.push(`${label}: root is missing a direct desc child`);
    }
  }

  const visit = (node) => {
    if (node.nodeType === 7) issues.push(`${label}: processing instructions are forbidden`);
    if (node.nodeType === 1) {
      const elementName = String(node.localName ?? node.nodeName).toLowerCase();
      if (forbiddenElements.has(elementName) || elementName.startsWith("animate")) issues.push(`${label}: forbidden ${elementName} element`);

      for (let index = 0; index < node.attributes.length; index += 1) {
        const attribute = node.attributes.item(index);
        const localName = String(attribute.localName ?? attribute.name).toLowerCase();
        const qualifiedName = String(attribute.name).toLowerCase();
        const value = String(attribute.value).trim();

        if (localName.startsWith("on")) issues.push(`${label}: forbidden event handler attribute ${qualifiedName}`);
        if (localName === "style") issues.push(`${label}: style attributes are forbidden`);
        if ((attribute.namespaceURI === XML_NAMESPACE && localName === "base") || qualifiedName === "xml:base") {
          issues.push(`${label}: xml:base attributes are forbidden`);
        }
        if (localName === "href" && !localFragment.test(value)) {
          issues.push(`${label}: ${qualifiedName} must be a local fragment reference`);
        }
        if (localName === "src" && value) issues.push(`${label}: src resource attributes are forbidden`);
        inspectResourceValue(value, `${label}: ${qualifiedName}`, issues);
      }
    }
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
  };

  visit(document);
  return [...new Set(issues)];
};

export const assertSafeSvg = (source, label = "SVG", options = {}) => {
  const issues = inspectSvgSafety(source, label, options);
  if (issues.length) throw new Error(issues.join("; "));
};
