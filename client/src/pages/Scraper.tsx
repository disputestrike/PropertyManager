import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Download, RefreshCw, Trash2 } from 'lucide-react';
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
  buildingSizeSqft?: number | null;
  buildingLevels?: number | null;
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
    linkedinUrl?: string | null;
    source: string;
    verified: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

function looksLikeUsZip(raw: string): boolean {
  const cleaned = raw.replace(/\s+/g, '-').replace(/[^\d-]/g, '');
  return /^\d{5}(-\d{4})?$/.test(cleaned) || /^\d{9}$/.test(cleaned);
}

/** Normalize to 5+4 or 5-digit ZIP; null if invalid. */
function normalizeZipInput(raw: string): string | null {
  const z = raw.trim();
  if (!looksLikeUsZip(z)) return null;
  let cleaned = z.replace(/\s+/g, '-').replace(/[^\d-]/g, '');
  if (/^\d{9}$/.test(cleaned)) {
    cleaned = `${cleaned.slice(0, 5)}-${cleaned.slice(5)}`;
  }
  return cleaned;
}

/** Max ~31 mi matches the map API safe radius (~50 km); larger values were timing out and returning 0 buildings. */
const ZIP_RADIUS_MILES = [5, 10, 15, 20, 25, 30] as const;

export default function Scraper() {
  const [zipInput, setZipInput] = useState('');
  const [zipRadiusMiles, setZipRadiusMiles] = useState(String(ZIP_RADIUS_MILES[1]));
  const [isScanning, setIsScanning] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  /** Table filter only (after data is loaded). */
  const [sizePreset, setSizePreset] = useState<string>('any');

  const utils = trpc.useUtils();
  const {
    data: jobHistory,
    refetch: refetchHistory,
    error: jobHistoryError,
    isError: jobHistoryIsError,
    isLoading: jobHistoryLoading,
    isFetching: jobHistoryFetching,
  } = trpc.scraper.getJobHistory.useQuery();

  const {
    data: jobResults,
    error: jobResultsError,
    isError: jobResultsIsError,
    isFetching: jobResultsLoading,
  } = trpc.scraper.getJobResults.useQuery(
    { jobId: selectedJobId! },
    { enabled: !!selectedJobId }
  );

  const deleteJobMutation = trpc.scraper.deleteScrapingJob.useMutation({
    onSuccess: async () => {
      toast.success('Scrape removed');
      await utils.scraper.getJobHistory.invalidate();
      setSelectedJobId(null);
    },
    onError: err => {
      toast.error(err.message);
    },
  });

  const minSqftForFilter = useMemo(() => {
    if (sizePreset === 'any') return 0;
    const p = Number(sizePreset);
    return Number.isFinite(p) && p > 0 ? p : 0;
  }, [sizePreset]);

  useEffect(() => {
    if (selectedJobId !== null) return;
    if (!jobHistory?.length) return;
    setSelectedJobId(jobHistory[0].id);
  }, [jobHistory, selectedJobId]);

  const scrapeJobMutation = trpc.scraper.scrapeZipCode.useMutation({
    onSuccess: (data, variables) => {
      const r = variables.radiusMiles;
      toast.success(
        r != null
          ? `Scraping started — ${data.zipCode} · ${r} mi radius`
          : `Scraping started — ${data.zipCode}`
      );
      setZipInput('');
      setIsScanning(false);
      refetchHistory();
      setSelectedJobId(data.jobId);
    },
    onError: (error) => {
      toast.error(`Scraping failed: ${error.message}`);
      setIsScanning(false);
    },
  });

  const resetResultFilters = () => {
    setSizePreset('any');
  };

  const handleScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = normalizeZipInput(zipInput);
    if (!cleaned) {
      toast.error('Enter a valid U.S. ZIP code (e.g. 22201 or 20008-1234).');
      return;
    }
    const miles = Number(zipRadiusMiles);
    if (!Number.isFinite(miles) || miles < 5 || miles > 30) {
      toast.error('Choose a radius between 5 and 30 miles.');
      return;
    }

    setIsScanning(true);
    scrapeJobMutation.mutate({ query: cleaned, radiusMiles: miles });
  };

  const filteredProperties = (jobResults?.properties ?? []).filter((prop: PropertyWithManagers) => {
    if (minSqftForFilter <= 0) return true;
    const sq = prop.buildingSizeSqft;
    if (sq == null || Number.isNaN(Number(sq))) return false;
    return Number(sq) >= minSqftForFilter;
  });

  const totalInJob = jobResults?.properties?.length ?? 0;
  const hiddenByFilters =
    totalInJob > 0 && filteredProperties.length === 0 ? totalInJob : 0;

  const exportToCSV = () => {
    if (!jobResults?.properties?.length) {
      toast.error('No data to export');
      return;
    }
    const rowsSource = filteredProperties;
    if (rowsSource.length === 0) {
      toast.error('No rows match the size filter — set minimum to “Any size”, then export.');
      return;
    }

    const rows: string[] = [];
    rows.push(
      'Property Name,Address,City,State,ZIP Code,Property Type,Building Size Sqft,Building Levels,Manager Name,Manager Email,Manager Phone,Manager Company,Manager Title,Manager LinkedIn'
    );

    rowsSource.forEach((prop: PropertyWithManagers) => {
      if (prop.managers.length === 0) {
        rows.push(
          `"${prop.name}","${prop.address}","${prop.city}","${prop.state}","${prop.zipCode}","${prop.propertyType || ''}","${prop.buildingSizeSqft || ''}","${prop.buildingLevels || ''}","","","","","","",""`
        );
      } else {
        prop.managers.forEach(manager => {
          rows.push(
            `"${prop.name}","${prop.address}","${prop.city}","${prop.state}","${prop.zipCode}","${prop.propertyType || ''}","${prop.buildingSizeSqft || ''}","${prop.buildingLevels || ''}","${manager.name || ''}","${manager.email || ''}","${manager.phone || ''}","${manager.company || ''}","${manager.title || ''}","${manager.linkedinUrl || ''}"`
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

  const zipValid = looksLikeUsZip(zipInput.trim());

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Commercial Property Scraper</h1>
          <p className="text-gray-600 text-sm sm:text-base max-w-3xl">
            Enter a <span className="font-medium">ZIP</span> and a <span className="font-medium">radius</span> to pull
            commercial buildings from OpenStreetMap, then enrich contacts from the web. Use{' '}
            <span className="font-medium">minimum building size</span> below to narrow the table after the run — it
            does not change what gets downloaded.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
          <div className="lg:col-span-1 lg:sticky lg:top-6 lg:z-10">
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Recent Scrapes</CardTitle>
                <CardDescription className="text-xs">
                  Past jobs on this server — scroll if the list is long.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[min(70vh,32rem)] overflow-y-auto overscroll-contain pr-1">
                {jobHistoryIsError ? (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                    <p className="font-medium text-destructive">Could not load job history</p>
                    <p className="text-xs text-muted-foreground mt-1 break-words">{jobHistoryError?.message}</p>
                  </div>
                ) : jobHistoryLoading && !jobHistory ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    Loading history…
                  </div>
                ) : !jobHistory || jobHistory.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    {jobHistoryFetching ? "Refreshing…" : "No scraping jobs yet"}
                  </p>
                ) : (
                  jobHistory.map(job => (
                    <div
                      key={job.id}
                      className={`rounded-lg border-2 transition-all ${
                        selectedJobId === job.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedJobId(job.id)}
                        className="w-full text-left p-3"
                      >
                        <div className="flex items-center justify-between mb-1 gap-2">
                          <span className="font-medium text-sm line-clamp-2">{job.zipCode}</span>
                          <Badge className={`text-xs shrink-0 ${getStatusColor(job.status)}`}>
                            {job.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(job.createdAt).toLocaleDateString()}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          {job.totalProperties ?? 0} properties
                          {job.status === 'failed' && job.errorMessage ? (
                            <span className="block text-red-600 mt-1 line-clamp-2">{job.errorMessage}</span>
                          ) : null}
                        </div>
                      </button>
                      <div className="px-3 pb-2 flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-destructive hover:text-destructive"
                          disabled={deleteJobMutation.isPending}
                          onClick={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (
                              !window.confirm(
                                `Delete this scrape and all ${job.totalProperties ?? 0} saved properties? This cannot be undone.`
                              )
                            ) {
                              return;
                            }
                            deleteJobMutation.mutate({ jobId: job.id });
                          }}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-3 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Start a New Scrape</CardTitle>
                <CardDescription>
                  One ZIP covers a metro area when you widen the radius (e.g. 20 mi for Arlington from a nearby ZIP).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleScrape} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
                    <div className="space-y-2">
                      <Label htmlFor="scrape-zip">ZIP code</Label>
                      <Input
                        id="scrape-zip"
                        type="text"
                        placeholder="e.g. 22201"
                        value={zipInput}
                        onChange={e => setZipInput(e.target.value)}
                        disabled={isScanning}
                        autoComplete="postal-code"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="scrape-radius">Radius</Label>
                      <Select
                        value={zipRadiusMiles}
                        onValueChange={setZipRadiusMiles}
                        disabled={isScanning || !zipValid}
                      >
                        <SelectTrigger id="scrape-radius" className="w-full">
                          <SelectValue placeholder="Miles" />
                        </SelectTrigger>
                        <SelectContent>
                          {ZIP_RADIUS_MILES.map(m => (
                            <SelectItem key={m} value={String(m)}>
                              {m} miles
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="submit" disabled={isScanning || !zipValid} className="min-w-[120px]">
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
                    {!zipValid ? (
                      <span className="text-sm text-muted-foreground">Enter a valid U.S. ZIP to enable radius and run.</span>
                    ) : null}
                  </div>
                </form>
              </CardContent>
            </Card>

            {selectedJobId && jobResultsIsError ? (
              <Card>
                <CardContent className="py-8 space-y-2">
                  <p className="text-red-700 font-medium">Could not load this job</p>
                  <p className="text-sm text-gray-600">{jobResultsError?.message}</p>
                  <p className="text-xs text-muted-foreground">
                    With no OAuth server URL, all scrapes are listed for everyone on this server. If you use
                    OAuth, you only see jobs created while logged in as the same user.
                  </p>
                </CardContent>
              </Card>
            ) : selectedJobId && !jobResults && jobResultsLoading ? (
              <Card>
                <CardContent className="py-12 flex items-center justify-center gap-2 text-gray-600">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Loading results…
                </CardContent>
              </Card>
            ) : selectedJobId && jobResults ? (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <div>
                    <CardTitle>Results</CardTitle>
                    <CardDescription>
                      {filteredProperties.length} properties shown with{' '}
                      {filteredProperties.reduce((sum, p) => sum + p.managers.length, 0)} contacts
                      {jobResults.properties.length !== filteredProperties.length
                        ? ` (${jobResults.properties.length} in this job before size filter)`
                        : ''}
                    </CardDescription>
                  </div>
                  <Button onClick={exportToCSV} size="sm" variant="outline">
                    <Download className="mr-2 h-4 w-4" />
                    Export CSV
                  </Button>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-6 max-w-xl">
                    <div className="space-y-2 flex-1">
                      <Label htmlFor="filter-min-sq">Minimum building size</Label>
                      <Select value={sizePreset} onValueChange={setSizePreset}>
                        <SelectTrigger id="filter-min-sq" className="w-full">
                          <SelectValue placeholder="Size" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">Any size</SelectItem>
                          <SelectItem value="10000">10,000+ sq ft</SelectItem>
                          <SelectItem value="25000">25,000+ sq ft</SelectItem>
                          <SelectItem value="50000">50,000+ sq ft</SelectItem>
                          <SelectItem value="100000">100,000+ sq ft</SelectItem>
                          <SelectItem value="150000">150,000+ sq ft</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Filters this table only. Rows with no sq ft in the data are hidden when a minimum is set.
                      </p>
                    </div>
                    {minSqftForFilter > 0 ? (
                      <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={resetResultFilters}>
                        Clear size filter
                      </Button>
                    ) : null}
                  </div>

                  {hiddenByFilters > 0 ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                      <p className="font-medium">Size filter is hiding all {hiddenByFilters} properties</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={resetResultFilters}
                      >
                        Show any size
                      </Button>
                    </div>
                  ) : null}
                  {filteredProperties.length === 0 && !hiddenByFilters ? (
                    <p className="text-center text-gray-500 py-8">
                      No properties were saved for this job — try another ZIP/radius or check back later.
                    </p>
                  ) : filteredProperties.length === 0 ? null : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Property Name</TableHead>
                            <TableHead>Address</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Size (sqft)</TableHead>
                            <TableHead>Contact Name</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Phone</TableHead>
                            <TableHead>Title</TableHead>
                            <TableHead>Company</TableHead>
                            <TableHead>LinkedIn</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredProperties.map((prop: PropertyWithManagers) =>
                            prop.managers.length === 0 ? (
                              <TableRow key={prop.id}>
                                <TableCell className="font-medium">{prop.name}</TableCell>
                                <TableCell>{prop.address}</TableCell>
                                <TableCell>{prop.propertyType || '-'}</TableCell>
                                <TableCell>{prop.buildingSizeSqft?.toLocaleString() ?? '-'}</TableCell>
                                <TableCell colSpan={6} className="text-gray-500 italic">
                                  No contact info available
                                </TableCell>
                              </TableRow>
                            ) : (
                              prop.managers.map((manager, idx) => (
                                <TableRow key={`${prop.id}-${idx}`}>
                                  <TableCell className="font-medium">
                                    {idx === 0 ? prop.name : ''}
                                  </TableCell>
                                  <TableCell>{idx === 0 ? prop.address : ''}</TableCell>
                                  <TableCell>{idx === 0 ? prop.propertyType || '-' : ''}</TableCell>
                                  <TableCell>
                                    {idx === 0 ? prop.buildingSizeSqft?.toLocaleString() ?? '-' : ''}
                                  </TableCell>
                                  <TableCell>{manager.name || '-'}</TableCell>
                                  <TableCell>
                                    {manager.email ? (
                                      <a
                                        href={`mailto:${manager.email}`}
                                        className="text-blue-600 hover:underline"
                                      >
                                        {manager.email}
                                      </a>
                                    ) : (
                                      '-'
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {manager.phone ? (
                                      <a
                                        href={`tel:${manager.phone}`}
                                        className="text-blue-600 hover:underline"
                                      >
                                        {manager.phone}
                                      </a>
                                    ) : (
                                      '-'
                                    )}
                                  </TableCell>
                                  <TableCell>{manager.title || '-'}</TableCell>
                                  <TableCell>{manager.company || '-'}</TableCell>
                                  <TableCell>
                                    {manager.linkedinUrl ? (
                                      <a
                                        href={manager.linkedinUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-600 hover:underline text-sm"
                                      >
                                        Profile
                                      </a>
                                    ) : (
                                      '-'
                                    )}
                                  </TableCell>
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
                      ? 'Select a job under Recent Scrapes to view results.'
                      : 'Run a scrape to see results here'}
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
