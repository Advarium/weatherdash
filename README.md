# Weatherdash

A single-page, dependency-light dashboard that puts live hazard alerts and
weather data from public agencies on one interactive map. It aggregates severe
weather warnings, earthquakes, volcanoes, floods, wildfires, space weather and
disaster declarations from around the world, plus satellite, radar and climate
overlays, with no build step and no backend beyond a tiny CORS relay.

## Features

- **Interactive Leaflet map** with Esri dark and satellite basemaps, 34
  toggleable overlays, and click-to-locate from every sidebar row.
- **Cross-source alert index.** European (Meteoalarm), global (WMO, GDACS)
  and regional alerts are normalized into one store and rendered as
  per-country panels grouped by continent and sub-region, sorted by severity. US NWS alerts are grouped per region.
- **Header summary** of Extreme / Severe / Moderate counts across all sources,
  a live/stale data indicator and a local clock.
- **"Happening now" bar** that rotates through the five most recent items
  across every feed.
- **Search** for addresses and places (Photon geocoder) or for live events
  already loaded in the dashboard.
- **Themes.** Several colour and typography presets, remembered per browser. Some are just for fun and not terribly readable.
- **Auto-refresh** on a per-source cadence.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page markup: header, alert bar, map, layers panel, legend, sidebar panels. |
| `weatherdash.css` | All styling and theme variables. |
| `weatherdash.js` | Application code, organised one section per data source (state, load, parse, render, plot, fly-to). |
| `cors-proxy-worker.js` | Cloudflare worker code for personal setup (preferred) |

## CORS relay

Most sources serve CORS headers directly. Three do not (Meteoalarm, WMO, SWIC), so requests to them go through
`cors-proxy-worker.js`, deployed as a Cloudflare Worker. 

The worker accepts only `GET`/`HEAD` with a `?url=` parameter, allows only HTTPS targets whose hostname is on a fixed allowlist, forwards no cookies or credentials and strips them from responses, and adds CORS headers and a 20-second upstream timeout.

Clone this repo, then set `PROXY_BASE` at the top of `weatherdash.js` to your own worker URL.
This github pages site is using a free worker, so too many requests will likely reach the 100k invocation limit.
Leave it empty to disable the relay (those three sources will then fail to
load).

## Data sources and attribution

All data remains the property of its provider. The dashboard displays the
provider's attribution on the map for tile layers; the table below covers
every source. Check each provider's terms before commercial use or
redistribution.

### Alerts and hazards

| Source | Used for | Provider | Terms |
|---|---|---|---|
| [NWS API](https://api.weather.gov/) | Active US weather alerts and zone geometry | NOAA National Weather Service | US Government work, public domain |
| [USGS Earthquake Hazards](https://earthquake.usgs.gov/) | Recent earthquakes (GeoJSON feed) | US Geological Survey | US Government work, public domain |
| [USGS Volcano Hazards Program](https://volcanoes.usgs.gov/) | Elevated US volcanoes and VONA notices | US Geological Survey | US Government work, public domain |
| [GeoNet](https://www.geonet.org.nz/) | New Zealand volcanic alert levels | GNS Science / Toka Tū Ake EQC | [CC BY 3.0 NZ](https://www.geonet.org.nz/policy) |
| [NOAA SWPC](https://www.swpc.noaa.gov/) | Space weather alerts and planetary K-index | NOAA Space Weather Prediction Center | US Government work, public domain |
| [NASA EONET](https://eonet.gsfc.nasa.gov/) | Active natural events (fires, storms, volcanoes, ice) | NASA Earth Observatory | NASA open data |
| [OpenFEMA](https://www.fema.gov/about/openfema) | Disaster declarations | FEMA | US Government work, public domain |
| [SPC Storm Reports](https://www.spc.noaa.gov/climo/reports/) | Daily tornado, wind and hail reports | NOAA Storm Prediction Center | US Government work, public domain |
| [SPC Convective Outlook](https://www.spc.noaa.gov/products/outlook/) | Day 1 to 3 severe weather risk polygons | NOAA Storm Prediction Center | US Government work, public domain |
| [SPC Fire Weather Outlook](https://mapservices.weather.noaa.gov/) | Day 1 and 2 fire weather risk polygons (ArcGIS) | NOAA Storm Prediction Center | US Government work, public domain |
| [NWPS River Gauges](https://water.noaa.gov/) | River gauge flood status (ArcGIS) | NOAA National Water Prediction Service | US Government work, public domain |
| [US Drought Monitor](https://droughtmonitor.unl.edu/) | Weekly drought intensity polygons | National Drought Mitigation Center, USDA, NOAA | Free to use with citation: "The U.S. Drought Monitor is jointly produced by the National Drought Mitigation Center at the University of Nebraska-Lincoln, the United States Department of Agriculture, and the National Oceanic and Atmospheric Administration. Map courtesy of NDMC." |
| [MSC GeoMet](https://api.weather.gc.ca/) | Canadian weather alerts | Environment and Climate Change Canada | [Data Servers End-use Licence](https://eccc-msc.github.io/open-data/licence/readme_en/) |
| [GDACS](https://www.gdacs.org/) | Global disaster alerts (RSS) | European Commission Joint Research Centre | GDACS [terms](https://www.gdacs.org/About/termofuse.aspx) |
| [Meteoalarm](https://meteoalarm.org/) | Severe weather warnings for 39 European countries (CAP feeds) | EUMETNET | Attribution required; see [Meteoalarm terms](https://meteoalarm.org/en/live/page/terms-and-conditions) |
| [WMO SWIC](https://severeweather.wmo.int/) | Global severe weather alerts (WFS) | World Meteorological Organization, hosted by Hong Kong Observatory | WMO [terms](https://severeweather.wmo.int/) |

### Weather, ocean and climate overlays

| Source | Layer | Provider | Terms |
|---|---|---|---|
| [Open-Meteo](https://open-meteo.com/) | Surface wind barbs | Open-Meteo | [CC BY 4.0](https://open-meteo.com/en/terms), non-commercial free tier |
| [RainViewer](https://www.rainviewer.com/) | Global radar composite tiles | RainViewer | Free tier with attribution; see [API terms](https://www.rainviewer.com/api.html) |
| [Iowa State IEM](https://mesonet.agron.iastate.edu/) | NEXRAD composite reflectivity (CONUS) | Iowa Environmental Mesonet | Free service, attribution requested, provided on map |
| [DWD GeoServer](https://maps.dwd.de/) | German radar composite (WMS) | Deutscher Wetterdienst | [DWD open data](https://www.dwd.de/EN/service/copyright/copyright_node.html), attribution required, provided on map |
| [FMI Open Data](https://en.ilmatieteenlaitos.fi/open-data) | Finnish radar composite (WMS) | Finnish Meteorological Institute | [CC BY 4.0](https://en.ilmatieteenlaitos.fi/open-data-licence) |
| [EUMETView](https://view.eumetsat.int/) | Meteosat MTG-I FCI infrared, full disk (WMS) | EUMETSAT | [EUMETSAT data policy](https://www.eumetsat.int/eumetsat-data-licensing) |
| [NASA GIBS](https://earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs) | IMERG precipitation (NASA GPM); GOES-East and GOES-West infrared (NOAA/NESDIS); Himawari infrared (JMA); GRACE-FO groundwater (NASA/JPL); SMAP root-zone and surface soil moisture (NASA); GHRSST MUR sea surface temperature and sea ice (NASA/JPL PO.DAAC); OMPS ozone and OMI sulfur dioxide (NASA GSFC) | NASA EOSDIS, with the originating agencies credited per layer | NASA open data; GIBS [usage guidelines](https://nasa-gibs.github.io/gibs-api-docs/) |

### Basemaps, geocoding and libraries

| Source | Used for | Terms |
|---|---|---|
| [Esri World Dark Gray Base](https://www.arcgis.com/home/item.html?id=1970c1995b8f44749f4b9b6e81b5ba45) and [World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) | Basemap tiles | Esri [Terms of Use](https://www.esri.com/en-us/legal/terms/full-master-agreement); attribution to Esri and its data partners is shown on the map |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Data underlying the Esri dark basemap and Photon | © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/) |
| [Photon](https://photon.komoot.io/) | Address and place search | komoot, Apache 2.0; public instance for fair use |
| [Leaflet](https://leafletjs.com/) 1.9.4 | Map rendering | BSD 2-Clause |
| [Google Fonts](https://fonts.google.com/) | Theme typefaces (Barlow Condensed, DM Sans, Fira Code, IBM Plex Mono, IBM Plex Sans, Inter, Orbitron, Share Tech Mono, Sora, Space Grotesk, VT323) | SIL Open Font License |
| [Cloudflare Workers](https://workers.cloudflare.com/) | CORS relay hosting | Cloudflare terms |

## Notes

- Meteoalarm's green "no awareness required" entries are dropped at load.
  GDACS green alerts are kept on the map but excluded from the country panels
  and header counts.
- Daily satellite composites from GIBS are pinned two days back so the layer
  is always fully assembled; see `GIBS_DAILY_OFFSET`.
- This project is not affiliated with or endorsed by any of the agencies above.

## License

This project is subject to the GNU GPLv3.
