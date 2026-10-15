// Guard for every admin page: only logged-in users get in. Everyone else goes to the login
// screen and, after logging in, returns to the page they wanted.
import { Navigate, Outlet, useLocation } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/features/auth/use-auth";

export function RequireAuth() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) {
    return (
      <div className="p-8">
        <Skeleton className="h-8 w-64" />
      </div>
    );
  }
  if (!me.data) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }
  if (me.data.must_change_password) {
    return <Navigate to="/admin/new-password" replace />;
  }
  return <Outlet />;
}
