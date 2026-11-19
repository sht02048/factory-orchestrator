export const SERVICE_INSTALL_BIND = "127.0.0.1";

export function serviceInstallArgs(orcaPath: string): string[] {
  return [
    orcaPath,
    "serve",
    "service",
    "install",
    "--bind",
    SERVICE_INSTALL_BIND,
    "--command",
    orcaPath,
  ];
}
