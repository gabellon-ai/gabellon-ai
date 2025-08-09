"use client";
import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { TrendingUp, Home, Building2, Warehouse } from "lucide-react";
import { motion } from "framer-motion";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from "recharts";

// ---------- Types ----------
type Inputs = {
  // Current Home
  currentHomeValue: number;
  currentMortgageBalance: number;
  sellingCostsPct: number; // % of sale price
  capGainsTaxPct: number; // effective % on net gain (simplified)

  // Smaller Home (Buy)
  smallerHomePrice: number;
  smallerHomeClosingPct: number; // % of price
  downPaymentFromProceedsPct: number; // % of net proceeds allocated to down payment in scenario 2
  mortgageRatePct: number;
  mortgageYears: number;
  propertyTaxPct: number; // % of home value annually
  insuranceAnnual: number;
  hoaMonthly: number;
  maintenancePct: number; // % of home value annually
  homeAppreciationPct: number; // annual

  // Rent (High-rise)
  monthlyRent: number;
  rentAnnualInflationPct: number;

  // Storage
  includeStorage: boolean;
  storageMonthly: number;
  storageAnnualInflationPct: number;

  // Investments
  investReturnPct: number; // annual nominal
  investTaxDragPct: number; // annual tax drag on returns

  // Horizon & Discounting
  years: number;
  discountRatePct: number; // for NPV of cash flows
};

// ---------- Helpers ----------
const pct = (x: number) => x / 100;

function amortizationPayment(principal: number, annualRatePct: number, years: number) {
  const r = pct(annualRatePct) / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

function growAnnual(value: number, ratePct: number, years = 1) {
  return value * Math.pow(1 + pct(ratePct), years);
}

function toCurrency(n: number) {
  if (!isFinite(n)) return "-";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function npv(cashflows: number[], discountRatePct: number) {
  const r = pct(discountRatePct);
  return cashflows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + r, t), 0);
}

// ---------- Core Model ----------
function simulate(inputs: Inputs) {
  const I = inputs;
  // Proceeds from selling current home
  const grossSale = I.currentHomeValue;
  const sellingCosts = grossSale * pct(I.sellingCostsPct);
  const equityBeforeTax = grossSale - I.currentMortgageBalance - sellingCosts;
  const capGainsTax = Math.max(0, equityBeforeTax) * pct(I.capGainsTaxPct); // simplified
  const netProceeds = equityBeforeTax - capGainsTax;

  // Scenario A: Sell & Rent High-rise (invest 100% of net proceeds)
  // Scenario B: Sell, buy smaller home using a portion of proceeds for down payment, invest the rest
  // Scenario C: Rent High-rise + Storage, but allocate only 50% of proceeds to investments (rest kept in cash) — per user variant

  const years = I.years;

  const results: any[] = [];
  const yearlyData: any[] = [];

  // Setup repeating values by year
  let rent = I.monthlyRent;
  let storage = I.storageMonthly;
  let homeValue = I.smallerHomePrice;

  const mortgagePrincipalB = I.smallerHomePrice - (netProceeds * pct(I.downPaymentFromProceedsPct));
  const mortgagePayment = amortizationPayment(mortgagePrincipalB, I.mortgageRatePct, I.mortgageYears);
  const monthlyMortgageRate = pct(I.mortgageRatePct) / 12;
  let remainingPrincipal = mortgagePrincipalB;

  let investA = netProceeds; // 100% invested in scenario A
  let investB = netProceeds * (1 - pct(I.downPaymentFromProceedsPct)); // leftover after DP
  let investC = netProceeds * 0.5; // 50% invested
  let cashC = netProceeds * 0.5; // 50% parked cash (no return) to reflect user's option

  const investNetRate = I.investReturnPct - I.investTaxDragPct;

  const cashflowsA: number[] = [0]; // t=0 cash flow already embedded via netProceeds being invested
  const cashflowsB: number[] = [-(I.smallerHomePrice * pct(I.downPaymentFromProceedsPct)) - (I.smallerHomePrice * pct(I.smallerHomeClosingPct))];
  const cashflowsC: number[] = [0];

  for (let y = 1; y <= years; y++) {
    // Update investments (annual comp, simple)
    investA = growAnnual(investA, investNetRate);
    investB = growAnnual(investB, investNetRate);
    investC = growAnnual(investC, investNetRate);

    // Annual rent & storage
    const rentAnnual = rent * 12;
    const storageAnnual = (I.includeStorage ? storage : 0) * 12;

    // Update rent/storage for next year
    rent = rent * (1 + pct(I.rentAnnualInflationPct));
    storage = storage * (1 + pct(I.storageAnnualInflationPct));

    // Scenario A yearly cash outlay
    const outA = rentAnnual + storageAnnual;

    // Scenario B (Buy smaller home):
    // Mortgage amortization over 12 months
    let interestPaidYear = 0;
    let principalPaidYear = 0;
    for (let m = 0; m < 12; m++) {
      const interest = remainingPrincipal * monthlyMortgageRate;
      const principalPaid = Math.min(mortgagePayment - interest, remainingPrincipal);
      remainingPrincipal -= principalPaid;
      interestPaidYear += interest;
      principalPaidYear += principalPaid;
      if (remainingPrincipal <= 1e-6) break;
    }
    const propertyTax = homeValue * pct(I.propertyTaxPct);
    const maintenance = homeValue * pct(I.maintenancePct);
    const hoa = I.hoaMonthly * 12;
    const homeCostsB = interestPaidYear + propertyTax + maintenance + I.insuranceAnnual + hoa;
    // home appreciates annually
    homeValue = growAnnual(homeValue, I.homeAppreciationPct);

    // Scenario C yearly cash outlay (rent + storage); investments only half of proceeds
    const outC = rentAnnual + storageAnnual;

    // Net worth snapshots at year-end:
    const netWorthA = investA - outA; // simplistic: subtract that year's living CF (no debt/home)
    const netWorthB = investB + homeValue - remainingPrincipal - homeCostsB; // invest + equity (home - debt) - annual costs
    const netWorthC = investC + cashC - outC; // keep cashC flat, investC grows, subtract living costs

    yearlyData.push({
      year: y,
      netWorthA,
      netWorthB,
      netWorthC,
      investA,
      investB,
      investC,
      outA,
      homeCostsB,
      outC,
      remainingPrincipal: Math.max(0, remainingPrincipal),
      homeValue,
    });

    // Cash flows for NPV (negative = outflow)
    cashflowsA.push(-outA);
    cashflowsB.push(-homeCostsB); // mortgage interest+taxes+maint+hoa+ins as outflows; DP & closing at t=0 already
    cashflowsC.push(-outC);
  }

  // Terminal values (add liquidatable assets)
  const terminalA = yearlyData.at(-1)?.investA ?? 0;
  const terminalB = (yearlyData.at(-1)?.homeValue ?? 0) - (yearlyData.at(-1)?.remainingPrincipal ?? 0) + (yearlyData.at(-1)?.investB ?? 0);
  const terminalC = (yearlyData.at(-1)?.investC ?? 0) + cashC;

  const npvA = npv([...cashflowsA, terminalA], I.discountRatePct);
  const npvB = npv([...cashflowsB, terminalB], I.discountRatePct);
  const npvC = npv([...cashflowsC, terminalC], I.discountRatePct);

  results.push({ key: "A: Sell & Rent (invest 100%)", npv: npvA, terminal: terminalA });
  results.push({ key: "B: Sell & Buy Smaller (invest rest)", npv: npvB, terminal: terminalB });
  results.push({ key: "C: Rent + Storage (invest 50%)", npv: npvC, terminal: terminalC });

  return { netProceeds, yearlyData, results, equityBeforeTax, sellingCosts, capGins: capGainsTax };
}

// ---------- UI ----------
const NumberInput = ({ label, value, onChange, step = 1000, right = "" }: { label: string; value: number; onChange: (v: number) => void; step?: number; right?: string; }) => (
  <div className="space-y-1">
    <Label className="text-sm text-muted-foreground">{label}</Label>
    <div className="relative">
      <Input type="number" step={step} value={isFinite(value) ? value : 0} onChange={(e) => onChange(parseFloat(e.target.value || "0"))} className="pr-16" />
      {right && <span className="absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">{right}</span>}
    </div>
  </div>
);

export default function DownsizingAnalyzer() {
  const [inputs, setInputs] = useState<Inputs>({
    currentHomeValue: 1300000,
    currentMortgageBalance: 0,
    sellingCostsPct: 6,
    capGainsTaxPct: 0,

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

    investReturnPct: 6.5,
    investTaxDragPct: 0.5,

    years: 15,
    discountRatePct: 5.5,
  });

  const { yearlyData, results, netProceeds, equityBeforeTax, sellingCosts, capGins } = useMemo(() => simulate(inputs), [inputs]);

  const best = useMemo(() => {
    return [...results].sort((a, b) => b.npv - a.npv)[0];
  }, [results]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <motion.h1 initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="text-2xl md:text-3xl font-semibold tracking-tight">
        Downsize vs. Rent — Financial Analysis
      </motion.h1>

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Your Situation & Assumptions</CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-4">
          <div className="space-y-3">
            <h3 className="font-medium flex items-center gap-2"><Home className="w-4 h-4"/>Current Home</h3>
            <NumberInput label="Estimated Sale Price" value={inputs.currentHomeValue} onChange={(v)=>setInputs(i=>({...i,currentHomeValue:v}))} right="$" />
            <NumberInput label="Current Mortgage Balance" value={inputs.currentMortgageBalance} onChange={(v)=>setInputs(i=>({...i,currentMortgageBalance:v}))} right="$" />
            <NumberInput label="Selling Costs" value={inputs.sellingCostsPct} onChange={(v)=>setInputs(i=>({...i,sellingCostsPct:v}))} step={0.1} right="%" />
            <NumberInput label="Cap Gains/Taxes (effective)" value={inputs.capGainsTaxPct} onChange={(v)=>setInputs(i=>({...i,capGainsTaxPct:v}))} step={0.1} right="%" />
            <div className="text-sm text-muted-foreground">Net proceeds estimated: <span className="font-medium">{toCurrency(netProceeds)}</span></div>
          </div>

          <div className="space-y-3">
            <h3 className="font-medium flex items-center gap-2"><Building2 className="w-4 h-4"/>Smaller Home (Buy)</h3>
            <NumberInput label="Price" value={inputs.smallerHomePrice} onChange={(v)=>setInputs(i=>({...i,smallerHomePrice:v}))} right="$" />
            <NumberInput label="Closing Costs" value={inputs.smallerHomeClosingPct} onChange={(v)=>setInputs(i=>({...i,smallerHomeClosingPct:v}))} step={0.1} right="%" />
            <NumberInput label="Down Payment from Proceeds" value={inputs.downPaymentFromProceedsPct} onChange={(v)=>setInputs(i=>({...i,downPaymentFromProceedsPct:v}))} step={1} right="%" />
            <div className="grid grid-cols-3 gap-3">
              <NumberInput label="Rate" value={inputs.mortgageRatePct} onChange={(v)=>setInputs(i=>({...i,mortgageRatePct:v}))} step={0.1} right="%" />
              <NumberInput label="Years" value={inputs.mortgageYears} onChange={(v)=>setInputs(i=>({...i,mortgageYears:v}))} step={1} />
              <NumberInput label="Property Tax" value={inputs.propertyTaxPct} onChange={(v)=>setInputs(i=>({...i,propertyTaxPct:v}))} step={0.1} right="%" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <NumberInput label="Insurance (annual)" value={inputs.insuranceAnnual} onChange={(v)=>setInputs(i=>({...i,insuranceAnnual:v}))} step={100} right="$" />
              <NumberInput label="HOA (monthly)" value={inputs.hoaMonthly} onChange={(v)=>setInputs(i=>({...i,hoaMonthly:v}))} step={25} right="$" />
              <NumberInput label="Maintenance" value={inputs.maintenancePct} onChange={(v)=>setInputs(i=>({...i,maintenancePct:v}))} step={0.1} right="%" />
            </div>
            <NumberInput label="Home Appreciation (annual)" value={inputs.homeAppreciationPct} onChange={(v)=>setInputs(i=>({...i,homeAppreciationPct:v}))} step={0.1} right="%" />
          </div>

          <div className="space-y-3">
            <h3 className="font-medium flex items-center gap-2"><TrendingUp className="w-4 h-4"/>Rent, Storage & Investments</h3>
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label="Rent (monthly)" value={inputs.monthlyRent} onChange={(v)=>setInputs(i=>({...i,monthlyRent:v}))} step={100} right="$" />
              <NumberInput label="Rent Inflation (annual)" value={inputs.rentAnnualInflationPct} onChange={(v)=>setInputs(i=>({...i,rentAnnualInflationPct:v}))} step={0.1} right="%" />
            </div>
            <div className="flex items-center justify-between py-1">
              <Label className="text-sm">Include Storage Unit</Label>
              <Switch checked={inputs.includeStorage} onCheckedChange={(checked)=>setInputs(i=>({...i,includeStorage:checked}))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label="Storage (monthly)" value={inputs.storageMonthly} onChange={(v)=>setInputs(i=>({...i,storageMonthly:v}))} step={25} right="$" />
              <NumberInput label="Storage Inflation (annual)" value={inputs.storageAnnualInflationPct} onChange={(v)=>setInputs(i=>({...i,storageAnnualInflationPct:v}))} step={0.1} right="%" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <NumberInput label="Investment Return (annual)" value={inputs.investReturnPct} onChange={(v)=>setInputs(i=>({...i,investReturnPct:v}))} step={0.1} right="%" />
              <NumberInput label="Tax Drag on Returns" value={inputs.investTaxDragPct} onChange={(v)=>setInputs(i=>({...i,investTaxDragPct:v}))} step={0.1} right="%" />
              <NumberInput label="Horizon (years)" value={inputs.years} onChange={(v)=>setInputs(i=>({...i,years:v}))} step={1} />
            </div>
            <NumberInput label="Discount Rate for NPV" value={inputs.discountRatePct} onChange={(v)=>setInputs(i=>({...i,discountRatePct:v}))} step={0.1} right="%" />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="summary" className="w-full">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="charts">Charts</TabsTrigger>
          <TabsTrigger value="table">Year-by-Year Table</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <div className="grid md:grid-cols-3 gap-4">
            {results.map((r) => (
              <Card key={r.key} className={`border ${best.key === r.key ? "border-green-500" : ""}`}>
                <CardHeader>
                  <CardTitle className="text-base">{r.key}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div>NPV (incl. terminal): <span className="font-medium">{toCurrency(r.npv)}</span></div>
                  <div>Terminal Assets: <span className="font-medium">{toCurrency(r.terminal)}</span></div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="text-sm text-muted-foreground mt-3">Net proceeds estimated from sale: <span className="font-medium">{toCurrency(netProceeds)}</span> (Selling costs {toCurrency(sellingCosts)}; Taxes {toCurrency(capGins)}; Equity before tax {toCurrency(equityBeforeTax)}).</div>
        </TabsContent>

        <TabsContent value="charts">
          <div className="grid grid-cols-1 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Net Worth Over Time</CardTitle>
              </CardHeader>
              <CardContent style={{ width: "100%", height: 360 }}>
                <ResponsiveContainer>
                  <LineChart data={yearlyData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="year" />
                    <YAxis tickFormatter={(v)=>toCurrency(v)} />
                    <Tooltip formatter={(v: any)=>toCurrency(Number(v))} />
                    <Legend />
                    <Line type="monotone" dataKey="netWorthA" name="A: Rent (100% invest)" dot={false} />
                    <Line type="monotone" dataKey="netWorthB" name="B: Buy Smaller" dot={false} />
                    <Line type="monotone" dataKey="netWorthC" name="C: Rent+Storage (50% invest)" dot={false} />
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
                    <YAxis tickFormatter={(v)=>toCurrency(v)} />
                    <Tooltip formatter={(v: any)=>toCurrency(Number(v))} />
                    <Legend />
                    <Area type="monotone" dataKey="outA" name="A: Rent+Storage" stackId="1" />
                    <Area type="monotone" dataKey="homeCostsB" name="B: Home Costs" stackId="1" />
                    <Area type="monotone" dataKey="outC" name="C: Rent+Storage (50% invest)" stackId="1" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="table">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Year-by-Year Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="p-2">Year</th>
                      <th className="p-2">Invest A</th>
                      <th className="p-2">NetWorth A</th>
                      <th className="p-2">Home Value</th>
                      <th className="p-2">Mortgage Bal</th>
                      <th className="p-2">Invest B</th>
                      <th className="p-2">NetWorth B</th>
                      <th className="p-2">Out A</th>
                      <th className="p-2">Home Costs B</th>
                      <th className="p-2">Out C</th>
                      <th className="p-2">NetWorth C</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearlyData.map((row:any)=> (
                      <tr key={row.year} className="border-t">
                        <td className="p-2">{row.year}</td>
                        <td className="p-2">{toCurrency(row.investA)}</td>
                        <td className="p-2">{toCurrency(row.netWorthA)}</td>
                        <td className="p-2">{toCurrency(row.homeValue)}</td>
                        <td className="p-2">{toCurrency(row.remainingPrincipal)}</td>
                        <td className="p-2">{toCurrency(row.investB)}</td>
                        <td className="p-2">{toCurrency(row.netWorthB)}</td>
                        <td className="p-2">{toCurrency(row.outA)}</td>
                        <td className="p-2">{toCurrency(row.homeCostsB)}</td>
                        <td className="p-2">{toCurrency(row.outC)}</td>
                        <td className="p-2">{toCurrency(row.netWorthC)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="bg-muted/40">
        <CardHeader>
          <CardTitle className="text-base">Notes & Limitations</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <ul className="list-disc ml-5 space-y-1">
            <li>Taxes are simplified: capital gains at sale and an annual investment tax drag. For precise results, we can add brackets, basis, and primary-home exclusions.</li>
            <li>Rent, storage, home value, and maintenance all grow with simple annual rates.</li>
            <li>NPV includes a terminal value at the end of the horizon (liquidated investments and home equity).</li>
            <li>We can extend with income needs, Social Security, HOA special assessments, one-time remodels, etc.</li>
          </ul>
          <div className="pt-2">Want me to add more scenarios (e.g., pay cash for the smaller home, or vary investment split)? Say the word and I’ll wire it in.</div>
        </CardContent>
      </Card>
    </div>
  );
}
