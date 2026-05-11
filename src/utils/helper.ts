export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const getUserAge = (birthYear: string) => {
  const currentYear = new Date().getFullYear();

  const age = currentYear - Number(birthYear);
  return age
};
