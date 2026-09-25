/**
 * Default rubric seeded onto every new event: five fixed criteria whose
 * weights sum to exactly 1. Organizers may reweight before freezing;
 * the freeze hash covers whatever is stored.
 */

export const RUBRIC_CRITERIA = [
  {
    name: "Impact",
    description: "How much does this matter to real people?",
    weight: 0.25,
    position: 1,
  },
  {
    name: "Innovation",
    description: "How original is the approach?",
    weight: 0.2,
    position: 2,
  },
  {
    name: "Technical Execution",
    description: "How well is it built for the time available?",
    weight: 0.3,
    position: 3,
  },
  {
    name: "Design",
    description: "Is it clear and pleasant to use?",
    weight: 0.15,
    position: 4,
  },
  {
    name: "Presentation",
    description: "Is the demo convincing and honest?",
    weight: 0.1,
    position: 5,
  },
] as const;
