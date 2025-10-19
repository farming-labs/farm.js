/**
 * Complete example showing all ways to access middleware data in pages
 * This file demonstrates the three methods for accessing middleware data
 */

import type { PageProps } from 'farm';
import { getMiddlewareData, getMiddlewareValue, createMiddlewareAccessor } from 'farm/middleware';

// ============================================================================
// METHOD 1: Page Props (Recommended for simple cases)
// ============================================================================

export async function Method1_PageProps(props: PageProps) {
  // Access middleware data directly from page props
  const middlewareData = props.middleware ? await props.middleware : new Map();
  
  const user = middlewareData.get('user');
  const stats = middlewareData.get('dashboardStats');
  const notifications = middlewareData.get('notifications');
  
  return (
    <div>
      <h2>Method 1: Page Props</h2>
      <p>User: {user?.name}</p>
      <p>Stats: {stats?.views} views</p>
      <p>Notifications: {notifications?.length} unread</p>
    </div>
  );
}

// ============================================================================
// METHOD 2: Helper Functions (Clean and simple)
// ============================================================================

export async function Method2_Helpers() {
  // Get specific values with type hints
  const user = await getMiddlewareValue<{
    id: number;
    name: string;
    email: string;
  }>('user');
  
  const stats = await getMiddlewareValue<{
    views: number;
    clicks: number;
  }>('dashboardStats');
  
  // Or get all data
  const allData = await getMiddlewareData();
  console.log('All middleware data:', Object.fromEntries(allData));
  
  return (
    <div>
      <h2>Method 2: Helper Functions</h2>
      <p>User: {user?.name}</p>
      <p>Email: {user?.email}</p>
      <p>Views: {stats?.views}</p>
    </div>
  );
}

// ============================================================================
// METHOD 3: Type-Safe Accessor (Best for production)
// ============================================================================

// Define your middleware data shape (do this once in a shared file)
interface MyMiddlewareData {
  user: {
    id: number;
    name: string;
    email: string;
    role: 'admin' | 'user' | 'guest';
  };
  session: {
    id: string;
    expiresAt: Date;
  };
  dashboardStats: {
    views: number;
    clicks: number;
    revenue: number;
  };
  permissions: string[];
  featureFlags: {
    newUI: boolean;
    darkMode: boolean;
    betaFeatures: boolean;
  };
  notifications: Array<{
    id: number;
    message: string;
    read: boolean;
  }>;
}

// Create typed accessor
const getTypedMiddlewareData = createMiddlewareAccessor<MyMiddlewareData>();

export async function Method3_TypeSafe() {
  const data = await getTypedMiddlewareData();
  
  // ✅ FULLY TYPED! TypeScript knows all these properties
  const user = data.user;              // Type: { id: number; name: string; ... }
  const stats = data.dashboardStats;   // Type: { views: number; clicks: number; ... }
  const flags = data.featureFlags;     // Type: { newUI: boolean; ... }
  const perms = data.permissions;      // Type: string[]
  
  // TypeScript will error if you try to access non-existent properties!
  // const foo = data.nonExistent;  // ❌ TypeScript error!
  
  return (
    <div>
      <h2>Method 3: Type-Safe Accessor</h2>
      <div>
        <h3>User Info (Fully Typed)</h3>
        <p>Name: {user?.name}</p>
        <p>Role: {user?.role}</p>  {/* TypeScript knows role is 'admin' | 'user' | 'guest' */}
      </div>
      
      <div>
        <h3>Dashboard Stats</h3>
        <p>Views: {stats?.views}</p>
        <p>Clicks: {stats?.clicks}</p>
        <p>Revenue: ${stats?.revenue}</p>
      </div>
      
      <div>
        <h3>Feature Flags</h3>
        {flags?.newUI && <p>✨ New UI Enabled</p>}
        {flags?.darkMode && <p>🌙 Dark Mode On</p>}
        {flags?.betaFeatures && <p>🧪 Beta Features Active</p>}
      </div>
      
      <div>
        <h3>Permissions</h3>
        {perms?.includes('admin') && <AdminPanel />}
        {perms?.includes('write') && <WriteButton />}
      </div>
      
      <div>
        <h3>Notifications ({data.notifications?.length || 0})</h3>
        {data.notifications?.map(notif => (
          <div key={notif.id}>
            {notif.message} {notif.read ? '✓' : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// REAL-WORLD EXAMPLE: Complete Dashboard Page
// ============================================================================

export default async function DashboardPage(props: PageProps) {
  // Get typed middleware data
  const data = await getTypedMiddlewareData();
  
  // All this data was preloaded in middleware - zero extra database calls!
  const { user, dashboardStats, permissions, featureFlags, notifications } = data;
  
  // Redirect non-authenticated users (though middleware should handle this)
  if (!user) {
    return <div>Please login</div>;
  }
  
  return (
    <div className="dashboard">
      {/* Header with user info from middleware */}
      <header>
        <h1>Welcome back, {user.name}!</h1>
        <p>Role: {user.role}</p>
      </header>
      
      {/* Stats from middleware */}
      <div className="stats-grid">
        <StatCard title="Views" value={dashboardStats?.views || 0} />
        <StatCard title="Clicks" value={dashboardStats?.clicks || 0} />
        <StatCard title="Revenue" value={`$${dashboardStats?.revenue || 0}`} />
      </div>
      
      {/* Conditional rendering based on permissions from middleware */}
      {permissions?.includes('admin') && (
        <section>
          <h2>Admin Panel</h2>
          <AdminDashboard />
        </section>
      )}
      
      {/* Feature flags from middleware */}
      {featureFlags?.newUI ? (
        <NewDashboardUI stats={dashboardStats} />
      ) : (
        <LegacyDashboardUI stats={dashboardStats} />
      )}
      
      {/* Notifications from middleware */}
      <aside>
        <h3>Notifications</h3>
        {notifications?.map(notif => (
          <NotificationItem key={notif.id} notification={notif} />
        ))}
      </aside>
    </div>
  );
}

// Helper components
function StatCard({ title, value }: { title: string; value: number | string }) {
  return (
    <div className="stat-card">
      <h3>{title}</h3>
      <p>{value}</p>
    </div>
  );
}

function AdminDashboard() {
  return <div>Admin features...</div>;
}

function AdminPanel() {
  return <div>Admin panel...</div>;
}

function WriteButton() {
  return <button>Write</button>;
}

function NewDashboardUI({ stats }: any) {
  return <div>New UI with stats: {stats?.views}</div>;
}

function LegacyDashboardUI({ stats }: any) {
  return <div>Legacy UI with stats: {stats?.views}</div>;
}

function NotificationItem({ notification }: any) {
  return <div>{notification.message}</div>;
}

