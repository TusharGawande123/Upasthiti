// Starts the React app: translations, server-data cache and the router.
import "./app/i18n";
import "./styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { Toaster } from "sonner";
import { createAppRouter } from "./app/router";
import { ME_QUERY_KEY } from "./features/auth/use-auth";
import { setNotAuthenticatedHandler } from "./lib/api-client";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("index.html must contain <div id='root'>");
}

// Retry a failed server call once before showing an error (tests turn this off).
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
const router = createAppRouter();

// When the server says "please log in" (the session ended), forget the user: the guard on
// the admin pages then sends the browser to the login screen.
setNotAuthenticatedHandler(() => queryClient.setQueryData(ME_QUERY_KEY, null));

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Pages wait here (blank) for a moment while the translation file loads. */}
      <Suspense fallback={null}>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" />
      </Suspense>
    </QueryClientProvider>
  </StrictMode>,
);
