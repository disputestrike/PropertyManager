import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";
import { Search, Database, Download, Bell } from "lucide-react";

export default function Home() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">Commercial Property Scraper</h1>
          <p className="text-xl text-gray-600 mb-8">
            Find commercial properties and property manager contact information by ZIP code — no sign-in required.
          </p>
          <Button
            size="lg"
            className="bg-blue-600 hover:bg-blue-700"
            onClick={() => setLocation("/scraper")}
          >
            Open Property Scraper
          </Button>
          {user?.name ? (
            <p className="text-sm text-gray-500 mt-4">Signed in as {user.name}</p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-16">
          <Card>
            <CardHeader>
              <Search className="h-8 w-8 text-blue-600 mb-2" />
              <CardTitle>Easy Search</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">Enter any ZIP code to find commercial properties in seconds</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Database className="h-8 w-8 text-blue-600 mb-2" />
              <CardTitle>Complete Data</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">Get property names, addresses, and property manager contact information</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Download className="h-8 w-8 text-blue-600 mb-2" />
              <CardTitle>Export Results</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">Download your scraping results as CSV for easy analysis</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Bell className="h-8 w-8 text-blue-600 mb-2" />
              <CardTitle>Job history</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">Review past scrapes and results on the scraper page</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
