import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, Leaf, Zap, Sun, Car, Home } from "lucide-react";

export const Route = createFileRoute("/resources")({
  head: () => ({
    meta: [
      { title: "Resources · Clean Start" },
      {
        name: "description",
        content:
          "Independent, non-commercial resources for clean energy incentives, solar, EVs, and renter-friendly electrification.",
      },
      { property: "og:title", content: "Resources · Clean Start" },
      {
        property: "og:description",
        content: "Trusted, vendor-neutral places to go deeper on clean energy decisions.",
      },
    ],
  }),
  component: ResourcesPage,
});

type Resource = {
  title: string;
  description: string;
  label: string;
  href: string;
};

const incentives: Resource[] = [
  {
    title: "DSIRE",
    description:
      "The most comprehensive database of state and federal clean energy incentives and policies in the U.S., managed by NC State University.",
    label: "Incentives",
    href: "https://dsireusa.org",
  },
  {
    title: "EnergySage",
    description:
      "Compare solar, heat pump, and community solar options with unbiased marketplace data backed by the U.S. Department of Energy.",
    label: "Solar & Heat Pumps",
    href: "https://www.energysage.com",
  },
  {
    title: "IRS Home Energy Tax Credits",
    description:
      "Official IRS guidance on federal tax credits for energy-efficient home improvements including heat pumps, insulation, and windows.",
    label: "Tax Credits",
    href: "https://www.irs.gov/credits-deductions/home-energy-tax-credits",
  },
];

const solar: Resource[] = [
  {
    title: "PVWatts Calculator",
    description:
      "NREL's free tool to estimate how much electricity a solar system would generate at any U.S. address.",
    label: "Solar",
    href: "https://pvwatts.nlr.gov/",
  },
  {
    title: "Rewiring America Savings Calculator",
    description:
      "Nonprofit tool that estimates your savings and available incentives for heat pumps, solar, EVs, and other electrification upgrades.",
    label: "Electrification",
    href: "https://homes.rewiringamerica.org/calculator",
  },
  {
    title: "Rewiring America Personal Electrification Planner",
    description:
      "A step-by-step custom plan for electrifying your home, including upgrade sequencing, costs, and available rebates.",
    label: "Electrification",
    href: "https://homes.rewiringamerica.org/personal-electrification-planner",
  },
];

const evs: Resource[] = [
  {
    title: "DOE Alternative Fueling Station Locator",
    description:
      "The U.S. Department of Energy's official map of EV charging stations, updated daily across all 50 states.",
    label: "EVs",
    href: "https://afdc.energy.gov/stations",
  },
  {
    title: "EnergySage Community Solar",
    description:
      "Find and compare community solar subscriptions for renters and homeowners who can't install rooftop panels.",
    label: "Community Solar",
    href: "https://communitysolar.energysage.com",
  },
];

const renters: Resource[] = [
  {
    title: "Rewiring America — Electrification for Renters",
    description:
      "Renter-specific guidance on portable upgrades, talking to your landlord, and accessing EV and appliance credits.",
    label: "Renters",
    href: "https://www.rewiringamerica.org/",
  },
  {
    title: "IRS Energy Efficient Home Improvement Credit",
    description:
      "Detailed IRS page on the credit for insulation, windows, heat pumps, and home energy audits — up to $3,200 annually.",
    label: "Tax Credits",
    href: "https://www.irs.gov/credits-deductions/energy-efficient-home-improvement-credit",
  },
];

function ResourcesPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-12">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
          <Leaf className="h-3.5 w-3.5 text-primary" />
          Helpful links
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">Trusted places to go deeper.</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Every source below is independent, non-commercial, and publicly available. We've organized
          them by topic so you can pick up wherever your Clean Start conversation left off.
        </p>
      </header>

      <Section
        icon={<Zap className="h-3.5 w-3.5" />}
        eyebrow="Section 1"
        title="Incentives & Rebates"
        items={incentives}
      />
      <Section
        icon={<Sun className="h-3.5 w-3.5" />}
        eyebrow="Section 2"
        title="Solar & Home Energy"
        items={solar}
      />
      <Section
        icon={<Car className="h-3.5 w-3.5" />}
        eyebrow="Section 3"
        title="Electric Vehicles"
        items={evs}
      />
      <Section
        icon={<Home className="h-3.5 w-3.5" />}
        eyebrow="Section 4"
        title="Renters & Multifamily"
        items={renters}
      />

      <section className="mt-10 rounded-xl border border-dashed border-border bg-muted/30 p-5 text-xs text-muted-foreground">
        <p>
          Clean Start does not maintain, vet, or have any commercial relationship with the sites
          listed above. Links are provided for informational purposes — confirm details directly
          with the program or provider.
        </p>
      </section>
    </div>
  );
}

function Section({
  icon,
  eyebrow,
  title,
  items,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  items: Resource[];
}) {
  return (
    <section className="mb-12">
      <div className="mb-2 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary">
        {icon}
        {eyebrow}
      </div>
      <h2 className="mb-5 text-2xl font-semibold tracking-tight">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((r) => (
          <ResourceCard key={r.href} resource={r} />
        ))}
      </div>
    </section>
  );
}

function ResourceCard({ resource }: { resource: Resource }) {
  return (
    <a
      href={resource.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
          {resource.label}
        </span>
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-primary" />
      </div>
      <h3 className="font-medium text-foreground">{resource.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{resource.description}</p>
    </a>
  );
}
