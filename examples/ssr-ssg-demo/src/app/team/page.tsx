/**
 * Team Page - SSG with Async Data
 * 
 * This page is pre-rendered at BUILD TIME with async data fetching.
 * The data is fetched once during build and embedded in the static HTML.
 */

export const ssg = true;

export const metadata = {
  title: "Team - SSG with Data",
  description: "Static page with data fetched at build time",
};

// Simulated API call - in a real app, this would fetch from an API
async function getTeamMembers() {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 100));
  
  return [
    { id: 1, name: "Alice Johnson", role: "CEO", avatar: "👩‍💼" },
    { id: 2, name: "Bob Smith", role: "CTO", avatar: "👨‍💻" },
    { id: 3, name: "Carol Williams", role: "Design Lead", avatar: "👩‍🎨" },
    { id: 4, name: "David Brown", role: "Engineering Lead", avatar: "👨‍🔬" },
  ];
}

export default async function TeamPage() {
  // This async operation runs at BUILD TIME, not on each request
  const team = await getTeamMembers();
  const buildTime = new Date().toISOString();

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
            SSG
          </span>
          <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm font-medium">
            Async Data
          </span>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          Our Team
        </h1>

        <p className="text-gray-600 mb-4">
          This page fetches team data <strong>at build time</strong>.
          The data is embedded in the static HTML.
        </p>

        <div className="bg-gray-100 rounded-lg p-4">
          <p className="text-sm text-gray-500">Data fetched at: {buildTime}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {team.map((member) => (
          <div key={member.id} className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center gap-4">
              <div className="text-4xl">{member.avatar}</div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">{member.name}</h2>
                <p className="text-gray-600">{member.role}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Code Example</h2>
        <pre className="bg-gray-100 rounded p-4 text-sm overflow-x-auto">
{`// SSG with async data fetching
export const ssg = true;

async function getTeamMembers() {
  const res = await fetch('https://api.example.com/team');
  return res.json();
}

// Async component - data fetched at build time
export default async function TeamPage() {
  const team = await getTeamMembers();
  
  return (
    <ul>
      {team.map(m => <li key={m.id}>{m.name}</li>)}
    </ul>
  );
}`}
        </pre>
      </div>
    </div>
  );
}
