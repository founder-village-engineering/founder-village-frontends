import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultConfig } from "expo/metro-config";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const fromApp = createRequire(import.meta.url);
const config = getDefaultConfig(projectRoot);
const resolveDefault = config.resolver.resolveRequest;

export default {
  ...config,
  resolver: {
    ...config.resolver,
    // Keep the native renderer and app on the SDK's React instance, even if
    // the web-only sibling uses a different patch in this workspace.
    resolveRequest: ((context, moduleName, platform) => {
      if (
        platform &&
        platform !== "web" &&
        (moduleName === "react" || moduleName.startsWith("react/"))
      ) {
        return context.resolveRequest(
          { ...context, originModulePath: fromApp.resolve("./package.json") },
          moduleName,
          platform,
        );
      }
      return (resolveDefault ?? context.resolveRequest)(
        context,
        moduleName,
        platform,
      );
    }) satisfies NonNullable<typeof resolveDefault>,
  },
};
