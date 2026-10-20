import { config } from '../config/env';

/**
 * Is this an academic email domain? Used to verify researchers instantly (Stage 2.2).
 *
 * Patterns cover most of the world: example.edu, example.edu.ng, example.ac.uk, example.ac.za…
 * Many universities don't follow them (Canada, most of Europe), so a starter list is below and more can be
 * added without a code change via ACADEMIC_DOMAINS in .env. Anyone not recognised can still verify with a
 * work-email code or a staff-page link.
 */
const PATTERNS = [/(^|\.)edu$/, /\.edu\.[a-z]{2}$/, /\.ac\.[a-z]{2}$/];

const KNOWN = [
  // Canada
  'carleton.ca', 'uottawa.ca', 'utoronto.ca', 'mcgill.ca', 'ubc.ca', 'yorku.ca', 'uwindsor.ca', 'queensu.ca',
  'uwaterloo.ca', 'mcmaster.ca', 'ualberta.ca', 'ucalgary.ca', 'umontreal.ca', 'concordia.ca', 'dal.ca', 'sfu.ca',
  'uwo.ca', 'usask.ca', 'umanitoba.ca', 'torontomu.ca',
  // Europe (examples; extend via ACADEMIC_DOMAINS)
  'ethz.ch', 'epfl.ch', 'uva.nl', 'uu.nl', 'ku.dk', 'su.se', 'uio.no', 'helsinki.fi', 'lmu.de', 'hu-berlin.de',
  'sorbonne-universite.fr', 'sciencespo.fr', 'uniroma1.it', 'ucm.es', 'kuleuven.be', 'tcd.ie', 'ucd.ie',
];

export function domainOf(emailOrDomain: string) {
  const s = String(emailOrDomain).toLowerCase().trim();
  return s.includes('@') ? s.split('@').pop()! : s;
}

export function isAcademicDomain(emailOrDomain: string) {
  const d = domainOf(emailOrDomain);
  if (!d || !d.includes('.')) return false;
  if (PATTERNS.some((p) => p.test(d))) return true;
  return [...KNOWN, ...config.extraAcademicDomains].some((k) => d === k || d.endsWith(`.${k}`));
}
