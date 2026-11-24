import type { AtsName } from "./core.ts";

export type Workplace = "remote" | "hybrid" | "onsite";
export type PostingKind = "swe-newgrad" | "swe-senior" | "non-eng";
export type Variant = "conditionalSponsorship" | "captcha" | "serverError" | "multiPage" | "emailVerification";

export type Description = { intro: string; sections: { title: string; items: string[] }[] };

export type Posting = {
  id: string;
  title: string;
  kind: PostingKind;
  location: string;
  /** ISO 3166 alpha-2 */
  country: string;
  workplace: Workplace;
  department: string;
  team: string;
  description: Description;
  closed: boolean;
  variants: Variant[];
  updatedAt: string;
};

export type Board<V extends Record<string, string>> = {
  ats: AtsName;
  token: string;
  company: string;
  postings: Posting[];
  /** Named variant postings: name -> posting id. */
  variants: V;
};

const COUNTRY_NAMES: Record<string, string> = { US: "United States", CA: "Canada", GB: "United Kingdom", IN: "India" };
export const countryName = (code: string): string => COUNTRY_NAMES[code] ?? code;

function describe(company: string, title: string, kind: PostingKind): Description {
  if (kind === "non-eng") {
    return {
      intro: `${company} is growing fast and we are hiring a ${title} to help us tell our story and win customers. You will work across product, sales and design.`,
      sections: [
        { title: "What you'll do", items: ["Own planning and execution for launches and campaigns", "Partner with sales and customer teams to turn feedback into plans", "Report on results and iterate quickly"] },
        { title: "What we're looking for", items: ["3+ years of relevant experience", "Excellent written and verbal communication", "Comfort working with data"] },
        { title: "Benefits", items: ["Medical, dental and vision coverage", "Flexible time off", "Learning stipend"] },
      ],
    };
  }
  if (kind === "swe-senior") {
    return {
      intro: `${company} is looking for a ${title} to lead the design of systems that thousands of customers rely on every day. You will mentor engineers and set technical direction.`,
      sections: [
        { title: "What you'll do", items: ["Design and ship reliable, scalable backend services", "Lead design reviews and mentor engineers", "Improve observability and developer tooling"] },
        { title: "What we're looking for", items: ["7+ years of professional software engineering experience", "Deep experience with distributed systems and databases", "A track record of leading projects across teams"] },
        { title: "Benefits", items: ["Competitive salary and equity", "Medical, dental and vision coverage", "Home office stipend"] },
      ],
    };
  }
  return {
    intro: `${company} is hiring new graduate engineers. As a ${title} you will join a small team, ship code in your first week and learn from experienced mentors.`,
    sections: [
      { title: "What you'll do", items: ["Build features end to end across our TypeScript and Python stack", "Write tests and review code with your teammates", "Pair with senior engineers on design and on-call practices"] },
      { title: "What we're looking for", items: ["Bachelor's or Master's degree in Computer Science or a related field, graduating in 2026 or 2027", "Projects or internships that show you can build and ship software", "Curiosity and clear communication"] },
      { title: "Benefits", items: ["Competitive salary and equity", "Medical, dental and vision coverage", "Relocation assistance and mentorship program"] },
    ],
  };
}

export function descriptionHtml(d: Description): string {
  return `<p>${d.intro}</p>${d.sections.map((s) => `<h3>${s.title}</h3><ul>${s.items.map((i) => `<li>${i}</li>`).join("")}</ul>`).join("")}`;
}

export function descriptionPlain(d: Description): string {
  return `${d.intro}\n\n${d.sections.map((s) => `${s.title}\n${s.items.map((i) => `- ${i}`).join("\n")}`).join("\n\n")}`;
}

type Spec = {
  id: string;
  title: string;
  kind: PostingKind;
  location: string;
  country?: string;
  workplace: Workplace;
  department?: string;
  closed?: boolean;
  variants?: Variant[];
};

function postings(company: string, specs: Spec[]): Posting[] {
  return specs.map((s, i) => {
    const dept = s.department ?? (s.kind === "non-eng" ? "Go-To-Market" : "Engineering");
    return {
      id: s.id,
      title: s.title,
      kind: s.kind,
      location: s.location,
      country: s.country ?? "US",
      workplace: s.workplace,
      department: dept,
      team: s.kind === "non-eng" ? dept : "Product Engineering",
      description: describe(company, s.title, s.kind),
      closed: s.closed ?? false,
      variants: s.variants ?? [],
      updatedAt: `2026-11-${String(20 - i).padStart(2, "0")}T10:00:00-05:00`,
    };
  });
}

const gh = postings("Northwind Labs", [
  { id: "4410001", title: "Software Engineer, New Grad (2027)", kind: "swe-newgrad", location: "San Francisco, CA", workplace: "hybrid" },
  { id: "4410002", title: "Software Engineer, New Grad - Remote", kind: "swe-newgrad", location: "Remote - US", workplace: "remote" },
  { id: "4410003", title: "Senior Software Engineer, Platform", kind: "swe-senior", location: "New York, NY", workplace: "onsite" },
  { id: "4410004", title: "Product Marketing Manager", kind: "non-eng", location: "Chicago, IL", workplace: "hybrid", department: "Marketing" },
  { id: "4410005", title: "Software Engineer, New Grad - Payments", kind: "swe-newgrad", location: "Austin, TX", workplace: "hybrid", variants: ["conditionalSponsorship"] },
  { id: "4410006", title: "Software Engineer, New Grad - Infrastructure", kind: "swe-newgrad", location: "Seattle, WA", workplace: "onsite", variants: ["serverError"] },
  { id: "4410007", title: "Software Engineer, New Grad - Data", kind: "swe-newgrad", location: "Boston, MA", workplace: "onsite", closed: true },
]);

const lever = postings("Contoso Systems", [
  { id: "c0ffee01-5a1e-4b0b-9a10-000000000001", title: "Software Engineer I (New Grad)", kind: "swe-newgrad", location: "Redmond, WA", workplace: "hybrid" },
  { id: "c0ffee01-5a1e-4b0b-9a10-000000000002", title: "Software Engineer, New Grad - Remote", kind: "swe-newgrad", location: "Remote - US", workplace: "remote" },
  { id: "c0ffee01-5a1e-4b0b-9a10-000000000003", title: "Staff Software Engineer, Backend", kind: "swe-senior", location: "San Francisco, CA", workplace: "onsite" },
  { id: "c0ffee01-5a1e-4b0b-9a10-000000000004", title: "Customer Success Manager", kind: "non-eng", location: "Denver, CO", workplace: "hybrid", department: "Customer Success" },
  { id: "c0ffee01-5a1e-4b0b-9a10-000000000005", title: "Software Engineer, New Grad - Security", kind: "swe-newgrad", location: "Toronto, ON", country: "CA", workplace: "hybrid", variants: ["conditionalSponsorship"] },
  { id: "c0ffee01-5a1e-4b0b-9a10-000000000006", title: "Software Engineer, New Grad - Mobile", kind: "swe-newgrad", location: "London, UK", country: "GB", workplace: "onsite", variants: ["captcha"] },
  { id: "c0ffee01-5a1e-4b0b-9a10-000000000007", title: "Software Engineer, New Grad - Games", kind: "swe-newgrad", location: "Atlanta, GA", workplace: "onsite", closed: true },
]);

const ashby = postings("Fabrikam AI", [
  { id: "ab5b1000-7e57-4a11-8c00-000000000001", title: "Software Engineer, New Grad", kind: "swe-newgrad", location: "New York, NY", workplace: "hybrid" },
  { id: "ab5b1000-7e57-4a11-8c00-000000000002", title: "Software Engineer, New Grad - Remote", kind: "swe-newgrad", location: "Remote - US", workplace: "remote" },
  { id: "ab5b1000-7e57-4a11-8c00-000000000003", title: "Senior Machine Learning Engineer", kind: "swe-senior", location: "San Francisco, CA", workplace: "onsite" },
  { id: "ab5b1000-7e57-4a11-8c00-000000000004", title: "Recruiting Coordinator", kind: "non-eng", location: "Austin, TX", workplace: "hybrid", department: "People" },
  { id: "ab5b1000-7e57-4a11-8c00-000000000005", title: "Software Engineer, New Grad - Applied AI", kind: "swe-newgrad", location: "Bengaluru, India", country: "IN", workplace: "onsite", variants: ["conditionalSponsorship"] },
  { id: "ab5b1000-7e57-4a11-8c00-000000000006", title: "Software Engineer, New Grad - Full Stack", kind: "swe-newgrad", location: "Seattle, WA", workplace: "hybrid", variants: ["multiPage"] },
]);

const workday = postings("Woodgrove Bank", [
  { id: "R-10231", title: "Software Engineer, New Grad", kind: "swe-newgrad", location: "Austin, TX", workplace: "hybrid" },
  { id: "R-10232", title: "Financial Systems Analyst", kind: "non-eng", location: "Chicago, IL", workplace: "onsite", department: "Finance" },
  { id: "R-10233", title: "Senior Software Engineer, Payments", kind: "swe-senior", location: "Dallas, TX", workplace: "hybrid", variants: ["emailVerification"] },
  { id: "R-10234", title: "Software Engineer, New Grad - Risk", kind: "swe-newgrad", location: "Charlotte, NC", workplace: "onsite", closed: true },
]);

export const FIXTURE_BOARDS = {
  greenhouse: {
    ats: "greenhouse",
    token: "northwind",
    company: "Northwind Labs",
    postings: gh,
    variants: { conditionalSponsorship: "4410005", serverError: "4410006", closed: "4410007" },
  } as Board<{ conditionalSponsorship: string; serverError: string; closed: string }>,
  lever: {
    ats: "lever",
    token: "contoso",
    company: "Contoso Systems",
    postings: lever,
    variants: {
      conditionalSponsorship: "c0ffee01-5a1e-4b0b-9a10-000000000005",
      captcha: "c0ffee01-5a1e-4b0b-9a10-000000000006",
      closed: "c0ffee01-5a1e-4b0b-9a10-000000000007",
    },
  } as Board<{ conditionalSponsorship: string; captcha: string; closed: string }>,
  ashby: {
    ats: "ashby",
    token: "fabrikam",
    company: "Fabrikam AI",
    postings: ashby,
    variants: {
      conditionalSponsorship: "ab5b1000-7e57-4a11-8c00-000000000005",
      multiPage: "ab5b1000-7e57-4a11-8c00-000000000006",
    },
  } as Board<{ conditionalSponsorship: string; multiPage: string }>,
  workday: {
    ats: "workday",
    token: "woodgrove",
    company: "Woodgrove Bank",
    postings: workday,
    variants: { emailVerification: "R-10233", closed: "R-10234" },
  } as Board<{ emailVerification: string; closed: string }>,
};

export const SPONSORSHIP_LABEL = "Will you require sponsorship?";
export const VISA_LABEL = "What visa type will you need?";
export const AUTH_LABEL = "Are you legally authorized to work in the United States?";
