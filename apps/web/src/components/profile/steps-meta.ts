import type { OnboardingStepId } from "@autoply/core";

export const STEP_META: Record<OnboardingStepId, { title: string; short: string; description: string }> = {
  resume: {
    title: "Upload your resume",
    short: "Resume",
    description: "Autoply reads it to fill in your profile. You’ll check every field on the next pages.",
  },
  identity: { title: "Name and contact", short: "Contact", description: "How employers reach you." },
  experience: { title: "Work experience", short: "Experience", description: "Check each job pulled from your resume." },
  education: { title: "Education", short: "Education", description: "Schools, degrees and dates." },
  skills: { title: "Skills and more", short: "Skills", description: "Skills, languages, certifications, projects and publications." },
  authorization: {
    title: "Work authorization",
    short: "Authorization",
    description: "Legal statements made on every application. Answer them yourself; Autoply never guesses these.",
  },
  preferences: { title: "Job preferences", short: "Preferences", description: "Which jobs Autoply looks for and applies to." },
  eeo: { title: "Voluntary self-identification", short: "Self-ID", description: "Optional demographic questions. Defaults to “Decline to answer”." },
  screening: { title: "Screening questions", short: "Screening", description: "Answers to questions most applications ask." },
  voice: { title: "Cover letter voice", short: "Voice", description: "How your cover letters should read." },
  review: { title: "Review and finish", short: "Review", description: "Check everything once more before Autoply starts applying." },
};
