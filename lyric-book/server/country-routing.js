import countries from "i18n-iso-countries";
import english from "i18n-iso-countries/langs/en.json" with { type: "json" };

countries.registerLocale(english);

export function normalizeCountryCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return countries.isValid(code) ? code : "";
}

export function listCountries() {
  return Object.entries(countries.getNames("en"))
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function paymentProviderForCountry(countryCode) {
  return String(countryCode || "").toUpperCase() === "NG" ? "paystack" : "stripe";
}
