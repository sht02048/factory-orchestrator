import { z } from "zod";
import rootPackage from "../../../package.json" with { type: "json" };

export const GANGER_VERSION = z.object({ version: z.string() }).parse(rootPackage).version;
