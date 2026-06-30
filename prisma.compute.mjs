import { defineComputeConfig } from "@prisma/compute-sdk/config";

export default defineComputeConfig({
  region: "eu-central-1",
  app: {
    name: "izaija",
    framework: "nextjs",
    httpPort: 3000,
    build: {
      command: null,
      outputDirectory: ".next/standalone",
    },
  },
});
