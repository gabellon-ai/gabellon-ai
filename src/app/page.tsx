"use client";

import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { TrendingUp, Home, Building2, Warehouse } from "lucide-react";
import { motion } from "framer-motion";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";

// ---------- Types ----------
type Inputs = {
  // Current home (sale assumptions for A/B/C)
  currentHomeValue: number;
  currentMortgageBalance: number;
  sellingCostsPct: number;
  capGainsTaxPct: number;
  currentHomeAppreciationPct: number; // also used for Keep-Home scenario D

  // Smaller home (Scenario B)
  smallerHomePrice: number;
  smallerHomeClosingPct: number;
  downPaymentFromProceedsPct: number;
  mortgageRatePct: number;
  mortgageYears: number;
  propertyTaxPct: number;
  insuranceAnnual: number;
  hoaMonthly: number;
  maintenancePct: number;
  homeAppreciationPct: number;

  // Rent (A/C)
  monthlyRent: number;
  rentAnnualInflationPct: number;

  // Storage (C)
  includeStorage: boolean;
  storageMonthly: number;
  storageAnnualInflationPct: number;

  // Investment controls
  useIVV: boolean;
  ivvAnnualReturnPct: number; // baseline CAGR assumption for IVV
  investReturnPct: number; // manual baseline if not using IVV
  returnAdjustPct: number; // tweak up/down
  investTaxDragPct: number; // tax drag on return

  // Proceeds invested by scenario
  investShareA: number; // % of proceeds invested in A
  investShareB: number; // % of leftover proceeds invested in B
  investShareC: number; // % of proceeds invested in C

  // Scenario D: Keep Current Home (no sale, no mortgage)
  keepPropertyTaxAnnual: number; // e.g., 13500
  keepInsuranceAnnual: number; // e.g., 7000
  keepHoaMonthly: number; // e.g., 180
  keepExtraMaintAnnual: number; // e.g., pool/yard/etc

  years: number;
  discountRatePct: number;
};

// ---------- Helpers ----------
const pct = (x: number) => x / 100;
const toCurrency = (n: number) =>
  isFinite(n)
    ? n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    : "-";
function amortizationPayment(principal: number, annualRatePct: number, years: number) {
  const r = pct(annualRatePct) / 12;
  const n = years * 12;
  return r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n));
}
function growAnnual(value: number, ratePct: number, years = 1) {
  return value * Math.pow(1 + pct(ratePct), years);
}
function npv(cashflows: number[], discountRatePct: number) {
  const r = pct(discountRatePct);
  return cashflows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + r, t), 0);
}

// ---------- Core Model ----------
function simulate(I: Inputs) {
  // Proceeds if selling current home (A/B/C)
  const grossSale = I.currentHomeValue;
  const sellingCosts = grossSale * pct(I.sellingCostsPct);
  const equityBeforeTax = grossSale - I.currentMortgageBalance - sellingCosts;
  const capGainsTax = Math.max(0, equityBeforeTax) * pct(I.capGainsTaxPct);
  const netProceeds = equityBeforeTax - capGainsTax;

  // Investment return assumption
  const baseline = I.useIVV ? I.ivvAnnualReturnPct : I.investReturnPct;
  const investGrossRate = baseline + I.returnAdjustPct;
  const investNetRate = investGrossRate - I.investTaxDragPct;

  // Scenario B (buy smaller): mortgage setup
  const dpB = netProceeds * pct(I.downPaymentFromProceedsPct);
  const mortgagePrincipalB = Math.max(0, I.smallerHomePrice - dpB);
  const mortgagePayment = amortizationPayment(mortgagePrincipalB, I.mortgageRatePct, I.mortgageYears);
  const monthlyMortgageRate = pct(I.mortgageRatePct) / 12;
  let remainingPrincipal = mortgagePrincipalB;

  // Starting values
  let rent = I.monthlyRent;
  let storage = I.storageMonthly;
  let homeValueB = I.smallerHomePrice;
  let keepHomeValue = I.currentHomeValue;

  // Investments per scenario based on shares
  let investA = netProceeds * pct(I.investShareA);
  let investB = (netProceeds - dpB) * pct(I.investShareB);
  let investC = netProceeds * pct(I.investShareC);
  const cashC = netProceeds * (1 - pct(I.investShareC));

  const results: any[] = [];
  const yearlyData: any[] = [];

  const cashflowsA: number[] = [0];
  const cashflowsB: number[] = [-(I.smallerHomePrice * pct(I.smallerHomeClosingPct)) - dpB];
  const cashflowsC: number[] = [0];
  const cashflowsD: number[] = [0]; // keep home; no t=0 cash flow (no sale)

  for (let y = 1; y <= I.years; y++) {
    // Grow investments annually
    investA = growAnnual(investA, investNetRate);
    investB = growAnnual(investB, investNetRate);
    investC = growAnnual(investC, investNetRate);

    // Annual rent & storage (A & C)
    const rentAnnual = rent * 12;
    const storageAnnual = (I.includeStorage ? storage : 0) * 12;
    rent *= 1 + pct(I.rentAnnualInflationPct);
    storage *= 1 + pct(I.storageAnnualInflationPct);

    const outA = rentAnnual + storageAnnual;

    // Scenario B annual costs
    let interestPaidYear = 0;
    for (let m = 0; m < 12; m++) {
      const interest = remainingPrincipal * monthlyMortgageRate;
      const principalPaid = Math.min(mortgagePayment - interest, remainingPrincipal);
      remainingPrincipal -= principalPaid;
      interestPaidYear += interest;
      if (remainingPrincipal <= 1e-6) break;
    }
    const propertyTaxB = homeValueB * pct(I.propertyTaxPct);
    const maintenanceB = homeValueB * pct(I.maintenancePct);
    const hoaB = I.hoaMonthly * 12;
    const homeCostsB = interestPaidYear + propertyTaxB + maintenanceB + I.insuranceAnnual + hoaB;
    homeValueB = growAnnual(homeValueB, I.homeAppreciationPct);

    // Scenario C outflows (rent + storage)
    const outC = rentAnnual + storageAnnual;

    // Scenario D: Keep current home (no mortgage)
    const hoaD = I.keepHoaMonthly * 12;
    const outD = I.keepPropertyTaxAnnual + I.keepInsuranceAnnual + hoaD + I.keepExtraMaintAnnual;
    keepHomeValue = growAnnual(keepHomeValue, I.currentHomeAppreciationPct);

    // Net worth snapshots
    const netWorthA = investA - outA;
    const netWorthB = investB + homeValueB - remainingPrincipal - homeCostsB;
    const netWorthC = investC + cashC - outC;
    const netWorthD = keepHomeValue - outD; // simple: asset minus annual carrying cost

    yearlyData.push({
      year: y,
      netWorthA,
      netWorthB,
      netWorthC,
      netWorthD,
      investA,
      investB,
      investC,
      outA,
      homeCostsB,
      outC,
      outD,
      remainingPrincipal: Math.max(0, remainingPrincipal),
      homeValueB,
      keepHomeValue,
    });

    // Cash flows for NPV
    cashflowsA.push(-outA);
    cashflowsB.push(-homeCostsB);
    cashflowsC.push(-outC);
    cashflowsD.push(-outD);
  }

  // Terminal values at horizon end
  const terminalA = yearlyData.at(-1)?.investA ?? 0;
  const terminalB =
    (yearlyData.at(-1)?.homeValueB ?? 0) - (yearlyData.at(-1)?.remainingPrincipal ?? 0) + (yearlyData.at(-1)?.investB ?? 0);
  const terminalC = (yearlyData.at(-1)?.investC ?? 0) + cashC;
  const terminalD = yearlyData.at(-1)?.keepHomeValue ?? 0; // equity in current home

  const npvA = npv([...cashflowsA, terminalA], I.discountRatePct);
  const npvB = npv([...cashflowsB, terminalB], I.discountRatePct);
  const npvC = npv([...cashflowsC, terminalC], I.discountRatePct);
  const npvD = npv([...cashflowsD, terminalD], I.discountRatePct);

  results.push({ key: `A: Rent (invest ${I.investShareA}%)`, npv: npvA, terminal: terminalA, color: "from-sky-500/20 to-sky-500/5", stroke: "#0ea5e9" });
  results.push({ key: `B: Buy Smaller (invest ${I.investShareB}%)`, npv: npvB, terminal: terminalB, color: "from-emerald-500/20 to-emerald-500/5", stroke: "#10b981" });
  results.push({ key: `C: Rent+Storage (invest ${I.investShareC}%)`, npv: npvC, terminal: terminalC, color: "from-amber-500/20 to-amber-500/5", stroke: "#f59e0b" });
  results.push({ key: `D: Keep Current Home`, npv: npvD, terminal: terminalD, color: "from-violet-500/20 to-violet-500/5", stroke: "#8b5cf6" });

  return { netProceeds, yearlyData, results };
}

// ---------- UI Helpers ----------
const NumberInput = ({ label, value, onChange, step = 0.1, right = "" }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  right?: string;
}) => (
  <div className="space-y-1">
    <Label className="text-sm text-muted-foreground">{label}</Label>
    <div className="relative">
      <Input
        type="number"
        step={step}
        value={isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseFloat(e.target.value || "0"))}
        className="pr-16"
      />
      {right && (
        <span className="absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">{right}</span>
      )}
    </div>
  </div>
);

function ScenarioCard({ title, npv, terminal, highlight, icon, gradient }: {
  title: string;
  npv: number;
  terminal: number;
  highlight?: boolean;
  icon: React.ReactNode;
  gradient: string; // tailwind gradient classes
}) {
  return (
    <Card
      className={`relative overflow-hidden border ${
        highlight ? "border-green-500" : "border-transparent"
      } shadow-sm bg-gradient-to-br ${gradient}`}
    >
      <div className="absolute right-3 top-3 opacity-40">{icon}</div>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold tracking-wide">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white/60 dark:bg-zinc-900/40 p-3 shadow-sm">
            <div className="text-xs text-muted-foreground">NPV (incl. terminal)</div>
            <div className="text-base font-semibold">{toCurrency(npv)}</div>
          </div>
          <div className="rounded-xl bg-white/60 dark:bg-zinc-900/40 p-3 shadow-sm">
            <div className="text-xs text-muted-foreground">Terminal Assets</div>
            <div className="text-base font-semibold">{toCurrency(terminal)}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Small wrapper for clearly separated assumption groups
function MiniPanel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-gradient-to-br from-muted/40 to-background p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium tracking-wide">{title}</div>
          {subtitle ? <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div> : null}
        </div>
        <div className="h-2 w-2 rounded-full bg-primary/60" />
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export default function DownsizingAnalyzer() {
  const [inputs, setInputs] = useState<Inputs>({
    currentHomeValue: 1300000,
    currentMortgageBalance: 0,
    sellingCostsPct: 6,
    capGainsTaxPct: 0,
    currentHomeAppreciationPct: 3.0,

    smallerHomePrice: 700000,
    smallerHomeClosingPct: 2.5,
    downPaymentFromProceedsPct: 50,
    mortgageRatePct: 6.5,
    mortgageYears: 30,
    propertyTaxPct: 2.1,
    insuranceAnnual: 2500,
    hoaMonthly: 250,
    maintenancePct: 1.0,
    homeAppreciationPct: 3.0,

    monthlyRent: 4500,
    rentAnnualInflationPct: 3.0,

    includeStorage: true,
    storageMonthly: 350,
    storageAnnualInflationPct: 3.0,

    useIVV: true,
    ivvAnnualReturnPct: 8.0,
    investReturnPct: 6.5,
    returnAdjustPct: 0.0,
    investTaxDragPct: 0.5,

    investShareA: 100,
    investShareB: 50,
    investShareC: 50,

    keepPropertyTaxAnnual: 13500,
    keepInsuranceAnnual: 7000,
    keepHoaMonthly: 180,
    keepExtraMaintAnnual: 2500,

    years: 15,
    discountRatePct: 5.5,
  });

  const { yearlyData, results, netProceeds } = useMemo(() => simulate(inputs), [inputs]);
  const best = useMemo(() => [...results].sort((a, b) => b.npv - a.npv)[0], [results]);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Downsize vs. Rent — Financial Analysis</h1>
          <p className="text-sm text-muted-foreground mt-1">Model and compare four scenarios with adjustable assumptions and NPV.</p>
        </motion.div>
        <Card className="bg-gradient-to-r from-indigo-500/10 to-sky-500/10 border-none">
          <CardContent className="py-3 px-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Net Proceeds (A/B/C)</div>
              <div className="font-semibold">{toCurrency(netProceeds)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Horizon</div>
              <div className="font-semibold">{inputs.years} yrs</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Discount Rate</div>
              <div className="font-semibold">{inputs.discountRatePct}%</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Assumptions */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Assumptions</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Section Tabs-like header */}
          <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="rounded-xl border bg-muted/30 px-3 py-2">Current Home (Sale)</div>
            <div className="rounded-xl border bg-muted/30 px-3 py-2">Smaller Home (Buy)</div>
            <div className="rounded-xl border bg-muted/30 px-3 py-2">Rent, Storage & Investment</div>
            <div className="rounded-xl border bg-muted/30 px-3 py-2">Keep Current Home</div>
          </div>

          <div className="grid md:grid-cols-4 gap-6">
            {/* Current Home (sale) */}
            <MiniPanel title="Current Home (Sale)" subtitle="Used in A/B/C proceeds">
              <NumberInput label="Estimated Sale Price" value={inputs.currentHomeValue} onChange={(v)=>setInputs(i=>({...i,currentHomeValue:v}))} right="$" />
              <NumberInput label="Mortgage Balance" value={inputs.currentMortgageBalance} onChange={(v)=>setInputs(i=>({...i,currentMortgageBalance:v}))} right="$" />
              <NumberInput label="Selling Costs" value={inputs.sellingCostsPct} onChange={(v)=>setInputs(i=>({...i,sellingCostsPct:v}))} right="%" />
              <NumberInput label="Cap Gains/Taxes" value={inputs.capGainsTaxPct} onChange={(v)=>setInputs(i=>({...i,capGainsTaxPct:v}))} right="%" />
              <NumberInput label="Keep-Home Appreciation" value={inputs.currentHomeAppreciationPct} onChange={(v)=>setInputs(i=>({...i,currentHomeAppreciationPct:v}))} right="%" />
            </MiniPanel>

            {/* Smaller Home (B) */}
            <MiniPanel title="Smaller Home (Buy)">
              <NumberInput label="Price" value={inputs.smallerHomePrice} onChange={(v)=>setInputs(i=>({...i,smallerHomePrice:v}))} right="$" />
              <NumberInput label="Closing Costs" value={inputs.smallerHomeClosingPct} onChange={(v)=>setInputs(i=>({...i,smallerHomeClosingPct:v}))} right="%" />
              <NumberInput label="Down Payment from Proceeds" value={inputs.downPaymentFromProceedsPct} onChange={(v)=>setInputs(i=>({...i,downPaymentFromProceedsPct:v}))} right="%" />
              <div className="grid grid-cols-3 gap-3">
                <NumberInput label="Rate" value={inputs.mortgageRatePct} onChange={(v)=>setInputs(i=>({...i,mortgageRatePct:v}))} right="%" />
                <NumberInput label="Years" value={inputs.mortgageYears} onChange={(v)=>setInputs(i=>({...i,mortgageYears:v}))} step={1} />
                <NumberInput label="Property Tax %" value={inputs.propertyTaxPct} onChange={(v)=>setInputs(i=>({...i,propertyTaxPct:v}))} right="%" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <NumberInput label="Insurance (annual)" value={inputs.insuranceAnnual} onChange={(v)=>setInputs(i=>({...i,insuranceAnnual:v}))} step={100} right="$" />
                <NumberInput label="HOA (monthly)" value={inputs.hoaMonthly} onChange={(v)=>setInputs(i=>({...i,hoaMonthly:v}))} step={25} right="$" />
                <NumberInput label="Maintenance %" value={inputs.maintenancePct} onChange={(v)=>setInputs(i=>({...i,maintenancePct:v}))} right="%" />
              </div>
              <NumberInput label="Home Appreciation %" value={inputs.homeAppreciationPct} onChange={(v)=>setInputs(i=>({...i,homeAppreciationPct:v}))} right="%" />
            </MiniPanel>

            {/* Rent/Storage & Investment */}
            <MiniPanel title="Rent, Storage & Investment">
              <div className="grid grid-cols-2 gap-3">
                <NumberInput label="Rent (monthly)" value={inputs.monthlyRent} onChange={(v)=>setInputs(i=>({...i,monthlyRent:v}))} step={100} right="$" />
                <NumberInput label="Rent Inflation" value={inputs.rentAnnualInflationPct} onChange={(v)=>setInputs(i=>({...i,rentAnnualInflationPct:v}))} right="%" />
              </div>
              <div className="flex items-center justify-between py-1">
                <Label className="text-sm">Include Storage Unit</Label>
                <Switch checked={inputs.includeStorage} onCheckedChange={(checked)=>setInputs(i=>({...i,includeStorage:checked}))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumberInput label="Storage (monthly)" value={inputs.storageMonthly} onChange={(v)=>setInputs(i=>({...i,storageMonthly:v}))} step={25} right="$" />
                <NumberInput label="Storage Inflation" value={inputs.storageAnnualInflationPct} onChange={(v)=>setInputs(i=>({...i,storageAnnualInflationPct:v}))} right="%" />
              </div>

              <div className="flex items-center justify-between py-1">
                <Label className="text-sm">Use IVV return</Label>
                <Switch checked={inputs.useIVV} onCheckedChange={(useIVV)=>setInputs(i=>({...i,useIVV}))} />
              </div>
              {inputs.useIVV ? (
                <div className="grid grid-cols-2 gap-3">
                  <NumberInput label="IVV baseline CAGR" value={inputs.ivvAnnualReturnPct} onChange={(v)=>setInputs(i=>({...i,ivvAnnualReturnPct:v}))} right="%" />
                  <NumberInput label="Return adjustment (±)" value={inputs.returnAdjustPct} onChange={(v)=>setInputs(i=>({...i,returnAdjustPct:v}))} right="%" />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <NumberInput label="Manual return (annual)" value={inputs.investReturnPct} onChange={(v)=>setInputs(i=>({...i,investReturnPct:v}))} right="%" />
                  <NumberInput label="Return adjustment (±)" value={inputs.returnAdjustPct} onChange={(v)=>setInputs(i=>({...i,returnAdjustPct:v}))} right="%" />
                </div>
              )}
              <NumberInput label="Tax drag on returns" value={inputs.investTaxDragPct} onChange={(v)=>setInputs(i=>({...i,investTaxDragPct:v}))} right="%" />

              <div className="grid grid-cols-3 gap-3">
                <NumberInput label="Proceeds invested — A" value={inputs.investShareA} onChange={(v)=>setInputs(i=>({...i,investShareA:v}))} right="%" />
                <NumberInput label="Proceeds invested — B" value={inputs.investShareB} onChange={(v)=>setInputs(i=>({...i,investShareB:v}))} right="%" />
                <NumberInput label="Proceeds invested — C" value={inputs.investShareC} onChange={(v)=>setInputs(i=>({...i,investShareC:v}))} right="%" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumberInput label="Horizon (years)" value={inputs.years} onChange={(v)=>setInputs(i=>({...i,years:v}))} step={1} />
                <NumberInput label="Discount rate (NPV)" value={inputs.discountRatePct} onChange={(v)=>setInputs(i=>({...i,discountRatePct:v}))} right="%" />
              </div>
            </MiniPanel>

            {/* Keep Current Home (D) */}
            <MiniPanel title="Keep Current Home" subtitle="No mortgage">
              <NumberInput label="Property Tax (annual)" value={inputs.keepPropertyTaxAnnual} onChange={(v)=>setInputs(i=>({...i,keepPropertyTaxAnnual:v}))} step={100} right="$" />
              <NumberInput label="Insurance (annual)" value={inputs.keepInsuranceAnnual} onChange={(v)=>setInputs(i=>({...i,keepInsuranceAnnual:v}))} step={100} right="$" />
              <NumberInput label="HOA (monthly)" value={inputs.keepHoaMonthly} onChange={(v)=>setInputs(i=>({...i,keepHoaMonthly:v}))} step={10} right="$" />
              <NumberInput label="Extra Maint (annual)" value={inputs.keepExtraMaintAnnual} onChange={(v)=>setInputs(i=>({...i,keepExtraMaintAnnual:v}))} step={100} right="$" />
            </MiniPanel>
          </div>
        </CardContent>
      </Card>

      {/* Scenario Summary Cards */}
      <div className="grid md:grid-cols-4 gap-4">
        {results.map((r, idx) => (
          <ScenarioCard
            key={r.key}
            title={r.key}
            npv={r.npv}
            terminal={r.terminal}
            highlight={r.key === best?.key}
            gradient={r.color}
            icon={
              idx === 0 ? (
                <TrendingUp className="w-6 h-6" />
              ) : idx === 1 ? (
                <Building2 className="w-6 h-6" />
              ) : idx === 2 ? (
                <Warehouse className="w-6 h-6" />
              ) : (
                <Home className="w-6 h-6" />
              )
            }
          />
        ))}
      </div>

      {/* Charts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Net Worth Over Time</CardTitle>
        </CardHeader>
        <CardContent style={{ width: "100%", height: 360 }}>
          <ResponsiveContainer>
            <LineChart data={yearlyData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis tickFormatter={(v) => toCurrency(v)} />
              <Tooltip formatter={(v: any) => toCurrency(Number(v))} />
              <Legend />
              <Line type="monotone" dataKey="netWorthA" name="A: Rent" dot={false} stroke="#0ea5e9" />
              <Line type="monotone" dataKey="netWorthB" name="B: Buy Smaller" dot={false} stroke="#10b981" />
              <Line type="monotone" dataKey="netWorthC" name="C: Rent+Storage" dot={false} stroke="#f59e0b" />
              <Line type="monotone" dataKey="netWorthD" name="D: Keep Home" dot={false} stroke="#8b5cf6" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Annual Cash Outflows</CardTitle>
        </CardHeader>
        <CardContent style={{ width: "100%", height: 360 }}>
          <ResponsiveContainer>
            <AreaChart data={yearlyData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis tickFormatter={(v) => toCurrency(v)} />
              <Tooltip formatter={(v: any) => toCurrency(Number(v))} />
              <Legend />
              <Area type="monotone" dataKey="outA" name="A: Rent+Storage" stackId="1" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.25} />
              <Area type="monotone" dataKey="homeCostsB" name="B: Home Costs" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.25} />
              <Area type="monotone" dataKey="outC" name="C: Rent+Storage" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.25} />
              <Area type="monotone" dataKey="outD" name="D: Keep Home" stackId="1" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.25} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
