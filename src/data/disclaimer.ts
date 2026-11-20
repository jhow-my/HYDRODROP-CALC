export interface DisclaimerSection {
  id: string;
  number: string;
  title: string;
  body: string;
}

export const DISCLAIMER_STORAGE_KEY = 'hydrodrop_disclaimer_acknowledged_v1';

export const DISCLAIMER_TITLE = 'Engineering Notice & Disclaimer';

export const DISCLAIMER_INTRO =
  'HydroDrop Calc is provided free of charge for public use as a preliminary hydraulic calculation and reference aid. By using this application or exporting its outputs, you acknowledge and agree to the following terms:';

export const DISCLAIMER_SECTIONS: DisclaimerSection[] = [
  {
    id: 'engineering-tool-only',
    number: '01',
    title: 'Engineering & Calculation Tool Only (No Professional Advice)',
    body: 'This application is provided as a general preliminary calculation and reference tool for domestic cold water (DCW) dropper sizing and hydraulic/static pressure estimation. It does not constitute professional engineering advice and does not replace independent engineering judgment, detailed site-specific design, or review and verification by a qualified / licensed professional engineer.',
  },
  {
    id: 'local-codes-compliance',
    number: '02',
    title: 'Compliance with Local Codes & Standards',
    body: 'Users are solely responsible for verifying all design assumptions, loading unit formulas, inputs, pipe specifications, velocity and pressure limits, PRV arrangements, and resulting designs against applicable local plumbing codes, national standards, water authority requirements, manufacturer data, and actual project conditions.',
  },
  {
    id: 'no-warranty-liability',
    number: '03',
    title: 'No Warranty & Limitation of Liability',
    body: 'Because HydroDrop Calc is offered free of charge on an "as-is" and "as-available" basis, there is no warranty (express or implied) of accuracy, completeness, reliability, or fitness for a particular purpose. Neither the author/developer nor the application providers shall be liable for any errors, omissions, losses, damages, or misuse arising from reliance on this tool or any of its calculations, diagrams, or exported reports.',
  },
];

export const DISCLAIMER_SUMMARY_LINE =
  'Preliminary calculation tool only — no warranty. Verify all inputs, pipe specs, and designs against local codes and qualified engineering judgment.';

export function hasAcknowledgedDisclaimer(): boolean {
  try {
    return window.localStorage.getItem(DISCLAIMER_STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

export function acknowledgeDisclaimer(): void {
  try {
    window.localStorage.setItem(DISCLAIMER_STORAGE_KEY, '1');
  } catch {
    // Ignore storage errors in restricted/private browsing modes
  }
}
