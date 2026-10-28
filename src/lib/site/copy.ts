/** Copy and contact details. Bracketed values are placeholders waiting for real copy. */
export const site = {
  name: "FRADY",
  person: "Caleb Frady",
  email: "[email]",
  city: "[City]",
  linkedin: "[linkedin-handle]",
  year: new Date().getFullYear(),
  hero: {
    line1: "Rooted in nature.",
    line2: "Engineered in code.",
    intro: "[One sentence on who you are and what you make.] [One sentence on the kind of work you take on.]",
    primary: "Start a project",
    secondary: "See the work",
  },
  services: {
    heading: "What I do.",
    text: "[One or two sentences on how these four areas fit together and who the work is for.]",
    items: [
      { name: "Content", text: "[One line on content work.]" },
      { name: "Systems", text: "[One line on systems work.]" },
      { name: "Ventures", text: "[One line on ventures.]" },
      { name: "Motion", text: "[One line on motion work.]" },
    ],
  },
  how: {
    line1: "[How I work, line one.]",
    line2: "[Line two.]",
    text: "[A short paragraph on process: how a project starts, what the first week looks like, and what you ship.]",
  },
  start: {
    line1: "Have something to build?",
    line2: "Let's make it grow.",
    text: "[One sentence on what to send and how soon you reply.]",
    cta: "Start a conversation",
  },
} as const;
