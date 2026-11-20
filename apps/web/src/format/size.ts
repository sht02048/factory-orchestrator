import { useLocale } from "use-intl";

const KILOBYTE = 1024;
const MEGABYTE = 1024 * 1024;

export function byteSize(bytes: number, locale: string): string {
  if (bytes < MEGABYTE) {
    return new Intl.NumberFormat(locale, { style: "unit", unit: "kilobyte" }).format(
      Math.ceil(bytes / KILOBYTE),
    );
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "megabyte",
    maximumFractionDigits: 1,
  }).format(bytes / MEGABYTE);
}

export function useByteSize(): (bytes: number) => string {
  const locale = useLocale();
  return (bytes) => byteSize(bytes, locale);
}
