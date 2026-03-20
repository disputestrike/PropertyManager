import { useState } from 'react';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, Download, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface PropertyWithManagers {
  id: number;
  scrapingJobId: number;
  name: string;
  address: string;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  propertyType?: string | null;
  source: string;
  sourceUrl?: string | null;
  createdAt: Date;
  managers: Array<{
    id: number;
    propertyId: number;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    company?: string | null;
    title?: string | null;
    website?: string | null;
    source: string;
    verified: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

export default function Scraper() {
  const { user } = useAuth();
  const [zipCode, setZipCode] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);

  const { data: jobHistory, refetch: refetchHistory } = trpc.scraper.getJobHistory.useQuery(undefined, {
    enabled: !!user,
  });

  const { data: jobResults } = trpc.scraper.getJobResults.useQuery(
    { jobId: selectedJobId! },
    { enabled: !!selectedJobId }
  );

  const scrapeJobMutation = trpc.scraper.scrapeZipCode.useMutation({
    onSuccess: (data) => {
      toast.success(`Scraping started for ZIP code ${data.zipCode}`);
      setZipCode('');
      setIsScanning(false);
      refetchHistory();
      // Auto-select the new job
      setSelectedJobId(data.jobId);
    },
    onError: (error) => {
      toast.error(`Scraping failed: ${error.message}`);
      setIsScanning(false);
    },
  });

  const handleScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!zipCode.trim()) {
      toast.error('Please enter a ZIP code');
      return;
    }

    setIsScanning(true);
    scrapeJobMutation.mutate({ zipCode: zipCode.trim() });
  };

  const exportToCSV = () => {
    if (!jobResults?.properties || jobResults.properties.length === 0) {
      toast.error('No data to export');
      return;
    }

    const rows: string[] = [];
    rows.push('Property Name,Address,City,State,ZIP Code,Property Type,Manager Name,Manager Email,Manager Phone,Manager Company,Manager Title');

    jobResults.properties.forEach((prop: PropertyWithManagers) => {
      if (prop.managers.length === 0) {
        rows.push(`"${prop.name}","${prop.address}","${prop.city}","${prop.state}","${prop.zipCode}","${prop.propertyType || ''}","","","","","""`);
      } else {
        prop.managers.forEach((manager) => {
          rows.push(
            `"${prop.name}","${prop.address}","${prop.city}","${prop.state}","${prop.zipCode}","${prop.propertyType || ''}","${manager.name || ''}","${manager.email || ''}","${manager.phone || ''}","${manager.company || ''}","${manager.title || ''}"`
          );
        });
      }
    });

    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `properties-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    toast.success('CSV exported successfully');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'running':
        return 'bg-blue-100 text-blue-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Commercial Property Scraper</h1>
          <p className="text-gray-600">Search for commercial properties and property manager contact information by ZIP code</p>
        </div>

        {/* Search Form */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Start a New Scrape</CardTitle>
            <CardDescription>Enter a ZIP code to find commercial properties and their property managers</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleScrape} className="flex gap-4">
              <Input
                type="text"
                placeholder="Enter ZIP code (e.g., 90210)"
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value)}
                disabled={isScanning}
                className="flex-1"
              />
              <Button type="submit" disabled={isScanning} className="min-w-[120px]">
                {isScanning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Scraping...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Scrape
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Job History */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recent Scrapes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {!jobHistory || jobHistory.length === 0 ? (
                  <p className="text-sm text-gray-500">No scraping jobs yet</p>
                ) : (
                  jobHistory.map((job) => (
                    <button
                      key={job.id}
                      onClick={() => setSelectedJobId(job.id)}
                      className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                        selectedJobId === job.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">{job.zipCode}</span>
                        <Badge className={`text-xs ${getStatusColor(job.status)}`}>
                          {job.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-gray-500">
                        {new Date(job.createdAt).toLocaleDateString()}
                      </div>
                      <div className="text-xs text-gray-600 mt-1">
                        {job.totalProperties} properties
                      </div>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* Results */}
          <div className="lg:col-span-3">
            {selectedJobId && jobResults ? (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Scraping Results</CardTitle>
                    <CardDescription>
                      {jobResults.properties.length} properties found with {jobResults.properties.reduce((sum, p) => sum + p.managers.length, 0)} property managers
                    </CardDescription>
                  </div>
                  <Button onClick={exportToCSV} size="sm" variant="outline">
                    <Download className="mr-2 h-4 w-4" />
                    Export CSV
                  </Button>
                </CardHeader>
                <CardContent>
                  {jobResults.properties.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">No properties found</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Property Name</TableHead>
                            <TableHead>Address</TableHead>
                            <TableHead>Manager Name</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Phone</TableHead>
                            <TableHead>Company</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {jobResults.properties.map((prop: PropertyWithManagers) =>
                            prop.managers.length === 0 ? (
                              <TableRow key={prop.id}>
                                <TableCell className="font-medium">{prop.name}</TableCell>
                                <TableCell>{prop.address}</TableCell>
                                <TableCell colSpan={4} className="text-gray-500 italic">
                                  No manager info available
                                </TableCell>
                              </TableRow>
                            ) : (
                              prop.managers.map((manager, idx) => (
                                <TableRow key={`${prop.id}-${idx}`}>
                                  <TableCell className="font-medium">
                                    {idx === 0 ? prop.name : ''}
                                  </TableCell>
                                  <TableCell>
                                    {idx === 0 ? prop.address : ''}
                                  </TableCell>
                                  <TableCell>{manager.name || '-'}</TableCell>
                                  <TableCell>
                                    {manager.email ? (
                                      <a href={`mailto:${manager.email}`} className="text-blue-600 hover:underline">
                                        {manager.email}
                                      </a>
                                    ) : (
                                      '-'
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {manager.phone ? (
                                      <a href={`tel:${manager.phone}`} className="text-blue-600 hover:underline">
                                        {manager.phone}
                                      </a>
                                    ) : (
                                      '-'
                                    )}
                                  </TableCell>
                                  <TableCell>{manager.company || '-'}</TableCell>
                                </TableRow>
                              ))
                            )
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-12">
                  <p className="text-center text-gray-500">
                    {jobHistory && jobHistory.length > 0
                      ? 'Select a scraping job from the left to view results'
                      : 'Start a scrape to see results here'}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
