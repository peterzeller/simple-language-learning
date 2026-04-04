const DEFAULT_ALLOWED_PATTERN = /^[\s\d.,:;!?()[\]{}%+\-/*=<>@#&|\\'"`~…→←—–•☀️🌙▶❚❚×]*$/u;

function isAllowedLiteral(value) {
  if (typeof value !== "string") return true;
  if (!value.trim()) return true;
  return DEFAULT_ALLOWED_PATTERN.test(value);
}

function shouldSkipText(node) {
  const parentName = node.parent?.name?.name;
  return parentName === "script" || parentName === "style";
}

const noLiteralStringRule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow hardcoded user-facing strings in JSX text nodes. Use translation keys instead.",
      recommended: false,
    },
    schema: [],
    messages: {
      literalString: "Hardcoded string found in JSX. Move this text to the i18n messages catalog.",
    },
  },
  create(context) {
    return {
      JSXText(node) {
        if (shouldSkipText(node)) return;
        if (isAllowedLiteral(node.value)) return;

        context.report({ node, messageId: "literalString" });
      },
    };
  },
};

const i18nextPlugin = {
  rules: {
    "no-literal-string": noLiteralStringRule,
  },
};

export default i18nextPlugin;
