/**
 * Participant Stage 2: the answer lists for the "About you" profile, per country.
 * The researcher's "Who you need" filters use the same lists, so every filter has an answer.
 */

export const REGIONS: Record<string, { label: string; list: string[] }> = {
  Nigeria: {
    label: 'State',
    list: [
      'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo',
      'Ekiti', 'Enugu', 'FCT (Abuja)', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
      'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
    ],
  },
  Ghana: {
    label: 'Region',
    list: [
      'Ahafo', 'Ashanti', 'Bono', 'Bono East', 'Central', 'Eastern', 'Greater Accra', 'North East', 'Northern', 'Oti', 'Savannah',
      'Upper East', 'Upper West', 'Volta', 'Western', 'Western North',
    ],
  },
  Kenya: {
    label: 'County',
    list: [
      'Baringo', 'Bomet', 'Bungoma', 'Busia', 'Elgeyo-Marakwet', 'Embu', 'Garissa', 'Homa Bay', 'Isiolo', 'Kajiado', 'Kakamega',
      'Kericho', 'Kiambu', 'Kilifi', 'Kirinyaga', 'Kisii', 'Kisumu', 'Kitui', 'Kwale', 'Laikipia', 'Lamu', 'Machakos', 'Makueni',
      'Mandera', 'Marsabit', 'Meru', 'Migori', 'Mombasa', "Murang'a", 'Nairobi', 'Nakuru', 'Nandi', 'Narok', 'Nyamira', 'Nyandarua',
      'Nyeri', 'Samburu', 'Siaya', 'Taita-Taveta', 'Tana River', 'Tharaka-Nithi', 'Trans Nzoia', 'Turkana', 'Uasin Gishu', 'Vihiga',
      'Wajir', 'West Pokot',
    ],
  },
};

export const COUNTRY_LANGUAGES: Record<string, string[]> = {
  Nigeria: ['English', 'Nigerian Pidgin', 'Hausa', 'Yoruba', 'Igbo', 'Fulfulde', 'Kanuri', 'Ibibio', 'Tiv', 'French'],
  Ghana: ['English', 'Twi', 'Fante', 'Ewe', 'Ga', 'Dagbani', 'Dagaare', 'Hausa', 'Nzema', 'French'],
  Kenya: ['English', 'Swahili', 'Kikuyu', 'Luo', 'Kalenjin', 'Luhya', 'Kamba', 'Kisii', 'Meru', 'Somali'],
};
/** Every language across the participant countries (the researcher's language filter). */
export const ALL_LANGUAGES = [...new Set(Object.values(COUNTRY_LANGUAGES).flat())];

export const GENDERS = ['female', 'male'] as const;
export const EDUCATION = ['none', 'primary', 'secondary', 'diploma', 'bachelor', 'master', 'doctorate', 'prefer-not'] as const;
export const WORK = ['employed', 'self-employed', 'not-working', 'prefer-not'] as const;
export const DEVICES = ['android', 'iphone', 'computer'] as const;

/** Local names for education levels (canvas 2.3). */
export function educationLabels(country: string): Record<(typeof EDUCATION)[number], string> {
  return {
    none: 'No formal schooling',
    primary: 'Primary school',
    secondary: country === 'Kenya' ? 'Secondary school (KCSE)' : country === 'Ghana' ? 'Secondary school (WASSCE)' : 'Secondary school (WAEC / NECO)',
    diploma: country === 'Nigeria' ? 'OND, HND, NCE or diploma' : 'Diploma or certificate',
    bachelor: "Bachelor's degree",
    master: "Master's degree",
    doctorate: 'Doctorate (PhD)',
    'prefer-not': 'Prefer not to say',
  };
}

export const optionsFor = (country: string) => ({
  regionLabel: REGIONS[country]?.label || 'Region',
  regions: REGIONS[country]?.list || [],
  languages: COUNTRY_LANGUAGES[country] || ALL_LANGUAGES,
  genders: [
    { value: 'female', label: 'Female' },
    { value: 'male', label: 'Male' },
  ],
  education: Object.entries(educationLabels(country)).map(([value, label]) => ({ value, label })),
  work: [
    { value: 'employed', label: 'Employed' },
    { value: 'self-employed', label: 'Self-employed' },
    { value: 'not-working', label: 'Not working' },
    { value: 'prefer-not', label: 'Prefer not to say' },
  ],
  devices: [
    { value: 'android', label: 'Android phone' },
    { value: 'iphone', label: 'iPhone' },
    { value: 'computer', label: 'Computer or laptop' },
  ],
});
