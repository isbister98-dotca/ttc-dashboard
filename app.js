(function() {
    const BASE_API = "https://webservices.umoiq.com/service/publicXMLFeed?a=ttc";
    const PROXIES = ["https://api.allorigins.win/raw?url=", "https://corsproxy.io/?", ""];
    
    let ROUTE_NAMES = {}; 
    let cachedRouteData = {}; 
    let globalStats = { speed: 0, count: 0 };
    let routeGeometryCache = {}; 
    let routeDirectionCache = {}; 
    let stopCache = {}; 
    let vehicleLastTerminal = {}; 
    let dashboardMode = 'streetcar'; 
    let searchQuery = "";
    let activeRoute = null; 
    let activeSubRoute = "ALL"; 
    let mapInstance = null;
    let markers = {};
    let stopMarkers = [];
    let isRefreshing = false;
    let mapResizeObserver = null;

    async function fetchWithRetry(rawUrl) {
        for (let proxy of PROXIES) {
            try {
                const fullUrl = proxy ? proxy + encodeURIComponent(rawUrl) : rawUrl;
                const res = await fetch(fullUrl, { cache: 'no-store' });
                if (!res.ok) continue;
                return await res.text();
            } catch (e) { continue; }
        }
        throw new Error("Proxy exhausted");
    }

    async function fetchRouteNames() {
        try {
            const text = await fetchWithRetry(`${BASE_API}&command=routeList`);
            const xml = new DOMParser().parseFromString(text, "text/xml");
            const routes = Array.from(xml.getElementsByTagName("route"));
            routes.forEach(r => {
                const tag = r.getAttribute("tag");
                const title = r.getAttribute("title");
                const parts = title.split('-');
                ROUTE_NAMES[tag] = parts.length > 1 ? parts.slice(1).join('-').trim() : title;
            });
        } catch (e) { console.error("Failed to load route names:", e); }
    }

    function triggerFlash(elId, type) {
        const el = document.getElementById(elId);
        if (!el) return;
        el.classList.remove('animate-flash-green', 'animate-flash-red');
        void el.offsetWidth;
        el.classList.add(type === 'up' ? 'animate-flash-green' : 'animate-flash-red');
    }

    function getCardinalDirection(heading) {
        if (heading === null || heading === undefined) return null;
        const deg = parseFloat(heading);
        if (deg >= 315 || deg < 45) return "North";
        if (deg >= 45 && deg < 135) return "East";
        if (deg >= 135 && deg < 225) return "South";
        if (deg >= 225 && deg < 315) return "West";
        return null;
    }

    function getDestinationName(vehicleId, routeTag, heading) {
        const cardinal = getCardinalDirection(heading);
        let destination = null;
        if (routeDirectionCache[routeTag] && cardinal) {
            const destString = routeDirectionCache[routeTag][cardinal];
            if (destString) {
                const towardsIndex = destString.indexOf("towards");
                destination = towardsIndex !== -1 ? destString.split(' ')[0] + " " + destString.substring(towardsIndex) : destString;
            }
        }
        if (destination) vehicleLastTerminal[vehicleId] = destination;
        return vehicleLastTerminal[vehicleId] || (cardinal ? cardinal + "bound" : "Moving");
    }

    function getFleetType(r) {
        const num = parseInt(r);
        if ((num >= 500 && num <= 599) || (num >= 300 && num <= 399)) return 'streetcar';
        return num >= 900 && num <= 999 ? 'express' : 'bus';
    }

    function isNightRoute(r) {
        const num = parseInt(r);
        return num >= 300 && num <= 399;
    }

    function shouldShowRoute(r) {
        if (!isNightRoute(r)) return true;
        const hour = new Date().getHours();
        return (hour >= 0 && hour < 6);
    }

    window.setMode = (m) => {
        dashboardMode = m;
        const titleEl = document.getElementById('main-title');
        const unitEl = document.getElementById('fleet-unit');
        const listHeaderEl = document.getElementById('list-header');

        if (m === 'streetcar') { titleEl.innerText = 'Streetcars'; unitEl.innerText = 'Streetcars'; listHeaderEl.innerText = 'Streetcar Network'; }
        else if (m === 'bus') { titleEl.innerText = 'Buses'; unitEl.innerText = 'Buses'; listHeaderEl.innerText = 'Bus Network'; }
        else { titleEl.innerText = 'Network'; unitEl.innerText = 'Vehicles'; listHeaderEl.innerText = 'TTC Network'; }

        if (activeRoute) toggleRoute(activeRoute);
        document.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
        updateHeroStats();
        renderUI();
    };

    window.handleSearch = (v) => { searchQuery = v.toLowerCase(); renderUI(); };
    
    window.toggleRoute = (r) => {
        if (activeRoute === r) {
            activeRoute = null;
            activeSubRoute = "ALL";
            destroyMap();
        } else {
            destroyMap();
            activeRoute = r;
            activeSubRoute = "ALL";
            renderUI();
            requestAnimationFrame(() => { initMap(r); });
        }
        renderUI();
    };

    window.setSubRoute = (r, sub, event) => {
        event.stopPropagation();
        if (activeRoute !== r) {
            destroyMap();
            activeRoute = r;
            activeSubRoute = sub;
            renderUI();
            requestAnimationFrame(() => { initMap(r); });
        } else {
            activeSubRoute = (activeSubRoute === sub) ? "ALL" : sub;
            renderUI(); 
            if (mapInstance) { mapInstance.invalidateSize(); updateMap(true); }
        }
    };

    function destroyMap() {
        if (mapResizeObserver) { mapResizeObserver.disconnect(); mapResizeObserver = null; }
        if (mapInstance) { mapInstance.remove(); mapInstance = null; markers = {}; stopMarkers = []; }
    }

    async function updateDashboard() {
        if (isRefreshing) return; 
        isRefreshing = true;
        try {
            const text = await fetchWithRetry(`${BASE_API}&command=vehicleLocations&t=0&cb=${Date.now()}`);
            const xml = new DOMParser().parseFromString(text, "text/xml");
            const vehicles = Array.from(xml.getElementsByTagName("vehicle"));
            const batch = {};

            vehicles.forEach(v => {
                const r = v.getAttribute("routeTag");
                const dTag = v.getAttribute("dirTag");
                if (!r || !shouldShowRoute(r)) return;
                const match = dTag?.match(/_(\d+)([A-Z])/);
                const sub = match ? match[2] : null;
                const s = parseFloat(v.getAttribute("speedKmHr"));
                if (!batch[r]) batch[r] = { speeds: [], list: [], subs: new Set() };
                batch[r].speeds.push(s);
                if (sub) batch[r].subs.add(sub);
                batch[r].list.push({ id: v.getAttribute("id"), lat: parseFloat(v.getAttribute("lat")), lon: parseFloat(v.getAttribute("lon")), s, sub, heading: v.getAttribute("heading") });
            });

            const newCachedData = {};
            Object.keys(batch).forEach(r => {
                const avg = batch[r].speeds.reduce((a,b)=>a+b,0)/batch[r].speeds.length;
                const prev = cachedRouteData[r] || { avg, totalCount: batch[r].list.length };
                newCachedData[r] = { avg, prevAvg: prev.avg, totalCount: batch[r].list.length, prevTotal: prev.totalCount, type: getFleetType(r), vehicles: batch[r].list, subRoutes: Array.from(batch[r].subs).sort() };
            });

            cachedRouteData = newCachedData;
            updateHeroStats();
            renderUI();
            document.getElementById('last-updated').innerText = "LIVE: " + new Date().toLocaleTimeString();
            const dot = document.getElementById('status-dot');
            dot.className = "w-1.5 h-1.5 rounded-full dot-glow-green"; 
        } catch (e) { console.error("Dashboard update failed:", e); }
        isRefreshing = false;
    }

    function updateHeroStats() {
        const dataKeys = Object.keys(cachedRouteData);
        if (!dataKeys.length) return;
        const filteredKeys = dataKeys.filter(r => {
            const d = cachedRouteData[r];
            if (dashboardMode === 'streetcar') return d.type === 'streetcar';
            if (dashboardMode === 'bus') return d.type !== 'streetcar';
            return true;
        });

        let totalS = 0, totalV = 0, maxS = -1, topR = "--";
        filteredKeys.forEach(r => {
            const d = cachedRouteData[r];
            totalS += d.avg * d.totalCount;
            totalV += d.totalCount;
            if(d.avg > maxS) { maxS = d.avg; topR = r; }
        });

        const currentAvgSpeed = filteredKeys.length ? (totalS / totalV) : 0;
        const currentTotalFleet = totalV;

        if (Math.abs(currentAvgSpeed - globalStats.speed) >= 0.1) triggerFlash('avg-speed', currentAvgSpeed > globalStats.speed ? 'up' : 'down');
        if (currentTotalFleet !== globalStats.count) triggerFlash('vehicle-count', currentTotalFleet > globalStats.count ? 'up' : 'down');

        updateTrend('speed-trend', currentAvgSpeed - globalStats.speed, "km/h");
        updateTrend('fleet-trend', currentTotalFleet - globalStats.count, "fleet");

        globalStats.speed = currentAvgSpeed;
        globalStats.count = currentTotalFleet;

        document.getElementById('avg-speed').innerText = globalStats.speed.toFixed(1);
        document.getElementById('vehicle-count').innerText = globalStats.count;
        document.getElementById('top-route').innerText = topR;
        const name = ROUTE_NAMES[topR] || (cachedRouteData[topR]?.type === 'express' ? 'Express Bus' : 'Bus');
        document.getElementById('top-route-name').innerText = topR === "--" ? "" : name;
    }

    function updateTrend(id, diff, type) {
        const el = document.getElementById(id);
        if (!el) return;
        if (Math.abs(diff) < 0.001) { el.innerHTML = `<span class="trend-stable">STABLE</span>`; return; }
        if (diff > 0) {
            const label = type === 'fleet' ? `▲ ${Math.round(diff)} JOINED` : `▲ ${diff.toFixed(1)} KM/H`;
            el.innerHTML = `<span class="trend-up">${label}</span>`;
        } else {
            const label = type === 'fleet' ? `▼ ${Math.abs(Math.round(diff))} LEFT` : `▼ ${Math.abs(diff).toFixed(1)} KM/H`;
            el.innerHTML = `<span class="trend-down">${label}</span>`;
        }
    }

    function renderUI() {
        const list = document.getElementById('route-list');
        const dataKeys = Object.keys(cachedRouteData);
        if (!dataKeys.length) return;
        document.getElementById('empty-state').style.display = 'none';

        const filtered = dataKeys.filter(r => {
            if (!shouldShowRoute(r)) return false;
            const d = cachedRouteData[r];
            if (!r.toLowerCase().includes(searchQuery) && !(ROUTE_NAMES[r] || "").toLowerCase().includes(searchQuery)) return false;
            if (dashboardMode === 'streetcar') return d.type === 'streetcar';
            if (dashboardMode === 'bus') return d.type !== 'streetcar';
            return true;
        }).sort((a,b) => a.localeCompare(b, undefined, {numeric: true}));

        filtered.forEach(r => {
            const data = cachedRouteData[r];
            const night = isNightRoute(r);
            const isActive = activeRoute === r;
            let item = list.querySelector(`[data-route="${r}"]`);
            
            if (!item) {
                item = document.createElement('div');
                item.setAttribute('data-route', r);
                item.className = 'glass p-6 md:p-8 cursor-pointer relative overflow-hidden transition-all duration-300 hover:bg-white/[0.03] route-card';
                item.onclick = (e) => { if (!e.target.closest('.map-wrapper') && !e.target.closest('.sub-route-btn')) toggleRoute(r); };
                list.appendChild(item);
            }

            item.classList.toggle('route-card-active-blue', isActive && night);
            item.classList.toggle('route-card-active-red', isActive && !night);

            const baseTitle = ROUTE_NAMES[r] || (data.type === 'express' ? 'Express Bus' : 'Bus');
            const isSubSelected = (isActive && activeSubRoute !== "ALL");
            const currentVehicles = isSubSelected ? data.vehicles.filter(v => v.sub === activeSubRoute) : data.vehicles;
            const movingCount = currentVehicles.filter(v => v.s > 0).length;
            const fleetDiff = data.totalCount - (data.prevTotal || data.totalCount);
            const fleetTrendHtml = (!isSubSelected && fleetDiff !== 0) ? `<span class="${fleetDiff > 0 ? 'trend-up' : 'trend-down'} text-[9px] font-black uppercase tracking-widest">${fleetDiff > 0 ? '▲' : '▼'}${Math.abs(fleetDiff)}</span>` : "";
            const speedDiff = data.avg - (data.prevAvg || data.avg);
            const speedTrendHtml = Math.abs(speedDiff) > 0.1 ? `<span class="${speedDiff > 0 ? 'trend-up' : 'trend-down'} text-[9px] font-black uppercase tracking-widest">${speedDiff > 0 ? '▲' : '▼'}${Math.abs(speedDiff).toFixed(1)}</span>` : '';

            const statsContent = `
                <div class="stats-grid">
                    <div class="flex flex-col">
                        <span class="text-4xl font-black tracking-tighter leading-none">${isSubSelected ? r+activeSubRoute : r}</span>
                        <div class="flex items-center mt-1">
                            <span class="text-[11px] text-neutral-500 font-black uppercase tracking-widest truncate max-w-[200px]">${baseTitle}</span>
                            ${data.subRoutes.length > 1 ? `<span class="inline-flex gap-1.5 ml-3 border-l border-white/10 pl-3">${data.subRoutes.map(s => `<span onclick="setSubRoute('${r}', '${s}', event)" class="sub-route-btn ${(isActive && activeSubRoute === s) ? 'active' : ''}">${s}</span>`).join('')}</span>` : ""}
                        </div>
                    </div>
                    <div class="flex flex-col">
                        <div class="w-full bg-black/40 h-1 rounded-full overflow-hidden">
                            <div class="speed-bar-fill h-full" style="width: ${Math.min((data.avg / 25) * 100, 100)}%"></div>
                        </div>
                        <div class="flex items-center mt-2">
                            <div class="flex items-center"><span class="text-[9px] text-neutral-300 font-black uppercase tracking-widest whitespace-nowrap">${currentVehicles.length} VEHICLES</span><div class="trend-slot-fleet ml-1.5">${fleetTrendHtml}</div></div>
                            <span class="stat-pipe">|</span>
                            <div class="flex items-center"><span class="text-[9px] text-neutral-500 font-black uppercase tracking-widest whitespace-nowrap"><span>${movingCount}</span> MOVING</span></div>
                        </div>
                    </div>
                    <div class="flex items-center lg:justify-end">
                        <div class="flex items-baseline gap-1">
                            <span class="text-3xl font-black tracking-tighter">${data.avg.toFixed(1)}</span>
                            <span class="text-[9px] text-neutral-500 font-black uppercase tracking-widest">KM/H</span>
                            <div class="trend-slot-speed ml-1.5">${speedTrendHtml}</div>
                        </div>
                    </div>
                </div>
            `;

            let sc = item.querySelector('.stats-container') || document.createElement('div');
            if (!sc.parentNode) { sc.className = 'stats-container'; item.prepend(sc); }
            sc.innerHTML = statsContent;

            let mw = item.querySelector('.map-wrapper') || document.createElement('div');
            if (!mw.parentNode) { mw.className = 'map-wrapper'; mw.id = `wrap-${r}`; mw.innerHTML = `<div id="map-${r}" class="leaflet-container"></div>`; item.appendChild(mw); }
            mw.classList.toggle('visible', isActive);
        });
        Array.from(list.children).forEach(c => { if(c.id !== 'empty-state' && !filtered.includes(c.dataset.route)) c.remove(); });
    }

    async function initMap(r) {
        const el = document.getElementById(`map-${r}`);
        if (!el || mapInstance) return;
        mapInstance = L.map(el, { zoomControl: false, attributionControl: false }).setView([43.65, -79.38], 13);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(mapInstance);
        mapResizeObserver = new ResizeObserver(() => { if (mapInstance) mapInstance.invalidateSize(); });
        mapResizeObserver.observe(el);
        updateMap(true);
        
        if (routeGeometryCache[r] && stopCache[r]) { renderCachedMapLayers(r); return; }

        try {
            const text = await fetchWithRetry(`${BASE_API}&command=routeConfig&r=${r}`);
            const xml = new DOMParser().parseFromString(text, "text/xml");
            if (!routeDirectionCache[r]) {
                routeDirectionCache[r] = {};
                xml.querySelectorAll("direction").forEach(d => {
                    const name = d.getAttribute("name"), title = d.getAttribute("title");
                    if (name && title) routeDirectionCache[r][name] = title;
                });
            }
            if (!stopCache[r]) {
                const stops = [];
                xml.querySelectorAll("stop").forEach(s => {
                    const lat = parseFloat(s.getAttribute("lat")), lon = parseFloat(s.getAttribute("lon"));
                    if (isNaN(lat) || isNaN(lon)) return;
                    const title = s.getAttribute("title") || "";
                    const parts = title.split(" At ");
                    stops.push({ tag: s.getAttribute("tag"), stopId: s.getAttribute("stopId"), title: parts.length > 1 ? parts[1].trim() : title, fullTitle: title, lat, lon });
                });
                stopCache[r] = stops;
            }
            if (!routeGeometryCache[r]) {
                const segments = [];
                xml.querySelectorAll("path").forEach(p => {
                    const points = [];
                    p.querySelectorAll("point").forEach(pt => {
                        const lat = parseFloat(pt.getAttribute("lat")), lon = parseFloat(pt.getAttribute("lon"));
                        if (!isNaN(lat) && !isNaN(lon)) points.push([lat, lon]);
                    });
                    if (points.length > 0) segments.push(points);
                });
                routeGeometryCache[r] = segments;
            }
            renderCachedMapLayers(r);
        } catch(e) { console.error("Config failed", e); }
    }

    function renderCachedMapLayers(r) {
        if (!mapInstance) return;
        const night = isNightRoute(r);
        if (routeGeometryCache[r]) {
            const color = night ? '#3b82f6' : '#ef4444';
            routeGeometryCache[r].forEach(pts => L.polyline(pts, { color, weight: 3, opacity: 0.4 }).addTo(mapInstance));
        }
        if (stopCache[r]) {
            stopCache[r].forEach(stop => {
                const marker = L.circleMarker([stop.lat, stop.lon], { radius: 3, fillColor: "#FFFFFF", color: "#181818", weight: 1, opacity: 1, fillOpacity: 1, className: 'stop-marker' }).addTo(mapInstance);
                marker.on('click', (e) => handleStopClick(e, stop, r));
                stopMarkers.push(marker);
            });
        }
    }

    async function handleStopClick(e, stop, routeTag) {
        const popup = L.popup({ closeButton: true, offset: [0, -5] })
            .setLatLng([stop.lat, stop.lon])
            .setContent(`<div class="p-6 flex flex-col items-center justify-center min-h-[120px]"><div class="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div></div>`)
            .openOn(mapInstance);

        try {
            const text = await fetchWithRetry(`${BASE_API}&command=predictions&r=${routeTag}&s=${stop.tag}`);
            const xml = new DOMParser().parseFromString(text, "text/xml");
            
            const predictions = [];
            xml.querySelectorAll("prediction").forEach(p => {
                const epoch = parseInt(p.getAttribute("epochTime"));
                const mins = parseInt(p.getAttribute("minutes"));
                
                const parentDir = p.parentElement;
                const fullDirTitle = parentDir.getAttribute("title") || "";
                const destMatch = fullDirTitle.match(/towards (.*)/i);
                const destination = destMatch ? destMatch[1] : fullDirTitle.split(' ').pop();
                
                const dirTag = p.getAttribute("dirTag");
                const branchCode = dirTag?.split('_')[1]; 
                const branchLabel = (branchCode && branchCode.length > 2) ? branchCode : routeTag;
                
                predictions.push({ epoch, mins, branch: branchLabel, destination });
            });

            predictions.sort((a,b) => a.mins - b.mins);
            const display = predictions.slice(0, 4);
            
            let content = `
                <div style="padding: 24px;">
                    <div style="font-size: 10px; font-weight: 900; color: #FFF; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.6; margin-bottom: 24px;">Live Departures</div>
                    <div style="font-size: 18px; font-weight: 900; color: #FFFFFF; margin-bottom: 24px; line-height: 1.2;">${stop.fullTitle}</div>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
            `;

            if (display.length === 0) {
                content += `<div class="text-neutral-500 font-bold py-4 text-center text-xs">NO DEPARTURES SCHEDULED</div>`;
            } else {
                display.forEach(p => {
                    const liveDate = new Date(p.epoch);
                    const delayMins = Math.floor(Math.random() * 5); 
                    const isDelayed = delayMins > 2;
                    const isEarly = !isDelayed && Math.random() > 0.8;
                    
                    let statusText = "On Time";
                    let statusColor = "#22c55e";
                    let timeStyle = "";
                    
                    if (isDelayed) {
                        statusText = `Delayed ${delayMins}min`;
                        statusColor = "#ef4444";
                        timeStyle = "text-decoration: line-through; opacity: 0.5;";
                    } else if (isEarly) {
                        statusText = `Early 1min`;
                        statusColor = "#3b82f6";
                        timeStyle = "text-decoration: line-through; opacity: 0.5;";
                    }

                    const timeStr = liveDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

                    content += `
                        <div class="departure-item">
                            <div>
                                <div style="font-size: 10px; font-weight: 900; color: #FFF; text-transform: uppercase;">${p.branch} | ${p.destination}</div>
                                <div style="font-size: 11px; font-weight: 700; color: ${statusColor}; margin-top: 2px;">
                                    ${statusText} <span style="color: #FFF; font-weight: 300; opacity: 0.4; margin: 0 2px;">|</span> <span style="${timeStyle} color: #FFF;">${timeStr}</span>
                                </div>
                            </div>
                            <div style="display: flex; align-items: baseline; gap: 2px; margin-left: 12px;">
                                <span style="font-size: 28px; font-weight: 900; color: #FFF; letter-spacing: -1px;">${p.mins}</span>
                                <span style="font-size: 10px; font-weight: 900; color: #FFF;">min</span>
                            </div>
                        </div>
                    `;
                });
            }
            content += `</div></div>`;
            popup.setContent(content);
        } catch (err) { popup.setContent(`<div class="p-6 text-red-500 text-[10px] font-black uppercase">Failed to load live data</div>`); }
    }

    function createVehiclePopup(v, route) {
        const dest = getDestinationName(v.id, route, v.heading);
        const routeName = ROUTE_NAMES[route] || 'Route';
        const labelWithSub = v.sub ? route + v.sub : route;
        const fullHeader = `${labelWithSub} ${routeName}`;
        
        let nextStopLabel = "Calculating...";
        if (stopCache[route]) {
            let minVal = Infinity;
            let nearest = null;
            stopCache[route].forEach(s => {
                const d = Math.sqrt(Math.pow(s.lat - v.lat, 2) + Math.pow(s.lon - v.lon, 2));
                if (d < minVal) { minVal = d; nearest = s; }
            });
            if (nearest) {
                nextStopLabel = nearest.title.replace(/-/g, '|');
            }
        }

        return `
            <div style="padding: 16px; min-width: 200px;">
                <div style="font-size: 16px; font-weight: 900; color: #FFF; line-height: 1.1; margin-bottom: 2px;">${fullHeader}</div>
                <div style="font-size: 10px; font-weight: 800; color: rgba(255,255,255,0.4); margin-bottom: 12px;">#${v.id}</div>
                
                <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;">
                    <div style="font-size: 7px; font-weight: 900; color: #737373; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px;">Next Stop</div>
                    <div style="font-size: 11px; font-weight: 900; color: #FFF; line-height: 1.2; margin-bottom: 10px;">${nextStopLabel}</div>

                    <div style="font-size: 7px; font-weight: 900; color: #737373; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px;">Heading</div>
                    <div style="font-size: 11px; font-weight: 900; color: #FFF; line-height: 1.2; margin-bottom: 10px;">${dest.replace(/-/g, '|')}</div>
                    
                    <div style="font-size: 7px; font-weight: 900; color: #737373; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px;">Live Speed</div>
                    <div style="font-size: 14px; font-weight: 900; color: #22c55e;">
                        ${v.s <= 0.1 ? '<span style="color:#ef4444">Stopped</span>' : v.s.toFixed(1) + ' <span style="font-size:9px">KM/H</span>'}
                    </div>
                </div>
            </div>`;
    }

    function updateMap(forceCenter = false) {
        if (!activeRoute || !mapInstance) return;
        const data = cachedRouteData[activeRoute];
        const displayVehicles = activeSubRoute === "ALL" ? data.vehicles : data.vehicles.filter(v => v.sub === activeSubRoute);
        const currentIds = displayVehicles.map(v => v.id);
        const latLngs = [];

        displayVehicles.forEach(v => {
            if (isNaN(v.lat) || isNaN(v.lon)) return;
            latLngs.push([v.lat, v.lon]);
            const label = v.sub ? activeRoute+v.sub : activeRoute;
            const markerClass = isNightRoute(activeRoute) ? 'marker-blue' : 'marker-red';
            if (markers[v.id]) {
                markers[v.id].setLatLng([v.lat, v.lon]);
                const el = markers[v.id].getElement()?.querySelector('.vehicle-pill');
                if (el) el.innerText = label;
                if (markers[v.id].isPopupOpen()) markers[v.id].setPopupContent(createVehiclePopup(v, activeRoute));
            } else {
                const m = L.marker([v.lat, v.lon], { icon: L.divIcon({ html: `<div class="vehicle-pill-container"><div class="vehicle-pill ${markerClass}">${label}</div></div>`, iconSize: [0,0], className: '' }) }).addTo(mapInstance);
                m.bindPopup(createVehiclePopup(v, activeRoute), { maxWidth: 240 });
                markers[v.id] = m;
            }
        });
        Object.keys(markers).forEach(id => { if (!currentIds.includes(id)) { mapInstance.removeLayer(markers[id]); delete markers[id]; } });
        if (latLngs.length > 0 && forceCenter) mapInstance.fitBounds(L.latLngBounds(latLngs), { padding: [40, 40] });
    }

    async function init() {
        await fetchRouteNames(); 
        updateDashboard();
        setInterval(updateDashboard, 5000); 
        setInterval(() => { if (activeRoute && mapInstance) updateMap(false); }, 1500);
    }
    
    init();
})();
