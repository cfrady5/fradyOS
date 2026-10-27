/** Copy and contact details. Bracketed values are placeholders waiting for real copy. */
export const site = {
  name: "FRADY",
  person: "Caleb Frady",
  email: "[email]",
  city: "[City]",
  linkedin: "[linkedin-handle]",
  year: new Date().getFullYear(),
  hero: {
    chip: "Open to new projects",
    line1: "Rooted in nature.",
    line2: "Engineered in code.",
    intro: "[One sentence on who you are and what you make.] [One sentence on the kind of work you take on.]",
    hint: "Move to light the field / Click to send a pulse",
    primary: "Start a project",
    secondary: "See the work",
  },
  strip: [
    { index: "01", label: "Content", text: "[One line on content work.]" },
    { index: "02", label: "Systems", text: "[One line on systems work.]" },
    { index: "03", label: "Ventures", text: "[One line on ventures.]" },
    { index: "04", label: "Motion", text: "[One line on motion work.]" },
  ],
  how: {
    line1: "[How I work, line one.]",
    line2: "[Line two.]",
    text: "[A short paragraph on process: how a project starts, what the first week looks like, and what you ship.]",
  },
  start: {
    line1: "Have something to build?",
    line2: "Let's make it grow.",
    cta: "Start a conversation",
  },
} as const;
