import * as React from "react";

export const useOnWindowResize = (handler: { (): void }) => {
  React.useEffect(() => {
    handler();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [handler]);
};