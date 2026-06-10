# build_database.ps1 - Delhivery Expense Dashboard Data Compiler
# Processes Jan, Feb, Mar, Apr, May monthly workbooks and generates data.js

$dir = "c:\Users\ajitdixit.int\OneDrive\vs_code\Dashboard"

Write-Host "Initializing Excel COM object..."
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

$excelEpoch = New-Object DateTime 1899, 12, 30

function Parse-ExcelDate($val) {
    if ($val -eq $null) { return $null }
    if ($val -is [double] -or $val -is [int]) {
        return $excelEpoch.AddDays($val)
    }
    $dateStr = $val.ToString().Trim()
    if ([string]::IsNullOrEmpty($dateStr)) { return $null }
    
    [datetime]$parsedDate = [datetime]::MinValue
    if ([DateTime]::TryParse($dateStr, [ref]$parsedDate)) {
        return $parsedDate
    }
    return $null
}

# Helper to parse double values from COM cells
function Parse-Double($val) {
    if ($val -eq $null -or $val -eq "#N/A" -or $val -eq "") { return 0.0 }
    [double]$res = 0.0
    if ([double]::TryParse($val.ToString(), [ref]$res)) {
        if ($res -lt 0) { return 0.0 } # Ignore COM error values
        return $res
    }
    return 0.0
}

$monthConfig = @(
    @{ filter="*Jan*"; key="jan"; val=1; name="January" }
    @{ filter="*Feb*"; key="feb"; val=2; name="February" }
    @{ filter="*Mar*"; key="mar"; val=3; name="March" }
    @{ filter="*Apr*"; key="apr"; val=4; name="April" }
    @{ filter="*May*"; key="may"; val=5; name="May" }
)

$rawRowsList = @()
$histData = @{}
$capsByMonth = @{}
$allCentersMap = @{}
$latLngMap = @{}
$deviationsList = @()

$STANDARD_CAPS = @{
    "Electricity Expenses" = 65000
    "Staff Welfare Expenses" = 8000
    "Water Expenses" = 5000
    "Internet Expenses" = 1770
    "Office Maintenance Expenses" = 5000
    "Labourer Charges" = 15000
    "Office consumables" = 5000
    "Power & Fuel Expense" = 3000
    "Repair AND Maintanance Expenses" = 3000
    "Printing AND Stationery" = 2000
    "Miscellaneous Expenses" = 6500
    "Parking Charges" = 1500
    "Conveyance Expenses" = 2000
    "Travelling Expenses" = 3000
    "Adhoc Vehicle Hire Expense" = 5000
}

$DEV_CAP_MAP = @{
    "Electricity Expenses" = "Electricity Benchmark"
    "Office Maintenance Expenses" = "Office Maintenance Benchmark"
    "Water Expenses" = "Water Benchmark"
    "Internet Expenses" = "Internet Benchmark"
    "Staff Welfare Expenses" = "Staff Welfare Benchmark"
}

try {
    foreach ($m in $monthConfig) {
        $mFiles = Get-ChildItem -Path $dir -Filter "*.xlsx" | Where-Object { $_.Name -like $m.filter }
        if ($mFiles.Count -eq 0) {
            Write-Warning "Workbook for $($m.name) matching filter $($m.filter) not found!"
            continue
        }
        $file = $mFiles[0]
        Write-Host "`nProcessing $($m.name) file: $($file.Name)..."
        
        $workbook = $excel.Workbooks.Open($file.FullName, [Type]::Missing, $true)
        
        # ----------------------------------------------------
        # 1. READ DEVIATIONS & CAP MAP FOR THE MONTH
        # ----------------------------------------------------
        Write-Host "  Loading 'Deviations' sheet..."
        $devSheet = $workbook.Worksheets.Item("Deviations")
        $devRange = $devSheet.UsedRange
        $devRows = $devRange.Rows.Count
        $devCols = $devRange.Columns.Count
        $devValues = $devRange.Value2
        
        # Map headers to indices
        $devHeaders = @{}
        for ($c = 1; $c -le $devCols; $c++) {
            $val = $devValues[1, $c]
            if ($val -ne $null -and $val.ToString().Trim() -ne "") {
                $devHeaders[$val.ToString().Trim()] = $c
            }
        }
        
        $monthKey = $m.key
        $capsByMonth[$monthKey] = @{}
        
        for ($r = 2; $r -le $devRows; $r++) {
            $hqVal = $devValues[$r, $devHeaders["HQ"]]
            if ($hqVal -eq $null -or [string]::IsNullOrEmpty($hqVal.ToString())) { continue }
            $hq = $hqVal.ToString().Trim()
            
            # Pull hierarchy metadata
            $sd = if ($devHeaders.ContainsKey("SD")) { $devValues[$r, $devHeaders["SD"]] } else { "Unknown" }
            $d = if ($devHeaders.ContainsKey("D")) { $devValues[$r, $devHeaders["D"]] } else { "Unknown" }
            $sm = if ($devHeaders.ContainsKey("SM")) { $devValues[$r, $devHeaders["SM"]] } else { "Unknown" }
            $stm = if ($devHeaders.ContainsKey("STM")) { $devValues[$r, $devHeaders["STM"]] } else { "Unknown" }
            $region = if ($devHeaders.ContainsKey("Region")) { $devValues[$r, $devHeaders["Region"]] } else { "" }
            $state = if ($devHeaders.ContainsKey("State")) { $devValues[$r, $devHeaders["State"]] } else { "" }
            $city = if ($devHeaders.ContainsKey("City")) { $devValues[$r, $devHeaders["City"]] } else { "" }
            $tier = if ($devHeaders.ContainsKey("Tier")) { $devValues[$r, $devHeaders["Tier"]] } else { "" }
            $lat = if ($devHeaders.ContainsKey("Latitude")) { $devValues[$r, $devHeaders["Latitude"]] } else { $null }
            $lng = if ($devHeaders.ContainsKey("Longitude")) { $devValues[$r, $devHeaders["Longitude"]] } else { $null }
            
            $sdStr = if ($sd -eq $null) { "Unknown" } else { $sd.ToString().Trim() }
            $dStr = if ($d -eq $null) { "Unknown" } else { $d.ToString().Trim() }
            $smStr = if ($sm -eq $null) { "Unknown" } else { $sm.ToString().Trim() }
            $stmStr = if ($stm -eq $null) { "Unknown" } else { $stm.ToString().Trim() }
            
            # Save unique center details (will keep latest monthly configuration)
            $allCentersMap[$hq] = @{
                "HQ Name" = $hq
                "SD" = $sdStr
                "D" = $dStr
                "SM" = $smStr
                "STM" = $stmStr
                "Region" = if ($region -eq $null) { "" } else { $region.ToString().Trim() }
                "State" = if ($state -eq $null) { "" } else { $state.ToString().Trim() }
                "City" = if ($city -eq $null) { "" } else { $city.ToString().Trim() }
                "Tier" = if ($tier -eq $null) { "" } else { $tier.ToString().Trim() }
                "Latitude" = $lat
                "Longitude" = $lng
            }
            
            if ($lat -ne $null -and $lng -ne $null) {
                $latLngMap[$hq] = @{ lat = [double]$lat; lng = [double]$lng }
            }
            
            # Store benchmarks
            foreach ($cat in $DEV_CAP_MAP.Keys) {
                $colName = $DEV_CAP_MAP[$cat]
                if ($devHeaders.ContainsKey($colName)) {
                    $val = $devValues[$r, $devHeaders[$colName]]
                    $capVal = Parse-Double($val)
                    if ($capVal -eq 0.0) { $capVal = 99999.0 }
                    $capsByMonth[$monthKey]["$hq||$cat"] = $capVal
                }
            }
            
            # For DeviationsList (representing the latest month deviations)
            if ($m.key -eq "may") {
                $devObj = @{
                    "HQ" = $hq
                    "SD" = $sdStr
                    "D" = $dStr
                    "SM" = $smStr
                    "STM" = $stmStr
                    "Region" = if ($region -eq $null) { "" } else { $region.ToString().Trim() }
                    "State" = if ($state -eq $null) { "" } else { $state.ToString().Trim() }
                    "City" = if ($city -eq $null) { "" } else { $city.ToString().Trim() }
                    "Tier" = if ($tier -eq $null) { "" } else { $tier.ToString().Trim() }
                    "Latitude" = $lat
                    "Longitude" = $lng
                }
                foreach ($cat in $DEV_CAP_MAP.Keys) {
                    $colName = $DEV_CAP_MAP[$cat]
                    if ($devHeaders.ContainsKey($colName)) {
                        $val = $devValues[$r, $devHeaders[$colName]]
                        $capVal = Parse-Double($val)
                        if ($capVal -eq 0.0) { $capVal = 99999.0 }
                        # Store as standard keys for client lookup
                        if ($colName -eq "Electricity Benchmark") { $devObj["Benchmark"] = $capVal }
                        elseif ($colName -eq "Office Maintenance Benchmark") { $devObj["Benchmark.1"] = $capVal }
                        elseif ($colName -eq "Water Benchmark") { $devObj["Benchmark.2"] = $capVal }
                        elseif ($colName -eq "Internet Benchmark") { $devObj["Benchmark.3"] = $capVal }
                        elseif ($colName -eq "Staff Welfare Benchmark") { $devObj["Benchmark.4"] = $capVal }
                    }
                }
                $deviationsList += $devObj
            }
        }
        
        # ----------------------------------------------------
        # 2. READ RAW TRANSACTIONS
        # ----------------------------------------------------
        Write-Host "  Loading 'branch_expense_report_(1)' sheet..."
        $rawSheet = $workbook.Worksheets.Item("branch_expense_report_(1)")
        $rawRange = $rawSheet.UsedRange
        $rawRows = $rawRange.Rows.Count
        $rawCols = $rawRange.Columns.Count
        $rawValues = $rawRange.Value2
        
        $rawHeaders = @{}
        for ($c = 1; $c -le $rawCols; $c++) {
            $val = $rawValues[1, $c]
            if ($val -ne $null -and $val.ToString().Trim() -ne "") {
                $rawHeaders[$val.ToString().Trim()] = $c
            }
        }
        
        $statusCol = $rawHeaders["Status"]
        $amtCol = $rawHeaders["Total Bill Amount"]
        $catCol = $rawHeaders["Category"]
        $centerCol = if ($rawHeaders.ContainsKey("HQ Name")) { $rawHeaders["HQ Name"] } else { $rawHeaders["Center Name"] }
        if (-not $centerCol) { $centerCol = $rawHeaders["Centre Name"] }
        
        $dateCol = $rawHeaders["Bill Date"]
        if (-not $dateCol) { $dateCol = $rawHeaders["OPS approval Date"] }
        if (-not $dateCol) { $dateCol = $rawHeaders["FIN approval Date"] }
        
        $monthRejected = 0.0
        $monthApprovedCount = 0
        $monthlyCatsTotals = @{}
        $monthlyCcSpend = @{}
        
        for ($r = 2; $r -le $rawRows; $r++) {
            $statusVal = $rawValues[$r, $statusCol]
            if ($statusVal -eq $null) { continue }
            $status = $statusVal.ToString().Trim()
            
            $amtVal = $rawValues[$r, $amtCol]
            $amt = Parse-Double($amtVal)
            
            if ($status -eq "Rejected") {
                $monthRejected += $amt
                continue
            }
            if ($status -ne "Approved") { continue }
            
            $centerVal = $rawValues[$r, $centerCol]
            if ($centerVal -eq $null) { continue }
            $center = $centerVal.ToString().Trim()
            
            $categoryVal = $rawValues[$r, $catCol]
            $category = if ($categoryVal -eq $null) { "Miscellaneous Expenses" } else { $categoryVal.ToString().Trim() }
            
            # Date normalization: force to target month (e.g. 2 for Feb) to fix Excel US locale formatting bugs
            $dateVal = $rawValues[$r, $dateCol]
            $rawDate = Parse-ExcelDate($dateVal)
            $day = 15
            if ($rawDate -ne $null) {
                $day = $rawDate.Day
            }
            
            $maxDays = [DateTime]::DaysInMonth(2026, $m.val)
            if ($day -gt $maxDays) { $day = $maxDays }
            $normalizedDate = [DateTime]::new(2026, $m.val, $day)
            $dateStr = $normalizedDate.ToString("yyyy-MM-dd")
            
            $rawRowsList += @{
                "Center Name" = $center
                "Category" = $category
                "Total Bill Amount" = $amt
                "Status" = $status
                "Bill Date" = $dateStr
            }
            
            $monthApprovedCount++
            
            if (-not $monthlyCatsTotals.ContainsKey($category)) { $monthlyCatsTotals[$category] = 0.0 }
            $monthlyCatsTotals[$category] += $amt
            
            if (-not $monthlyCcSpend.ContainsKey($center)) { $monthlyCcSpend[$center] = @{} }
            if (-not $monthlyCcSpend[$center].ContainsKey($category)) { $monthlyCcSpend[$center][$category] = 0.0 }
            $monthlyCcSpend[$center][$category] += $amt
        }
        
        # ----------------------------------------------------
        # 3. COMPUTE MONTHLY AGGREGATES FOR HIST
        # ----------------------------------------------------
        Write-Host "  Aggregating stats for $($m.name)..."
        $centerDetails = @{}
        $histOver = 0.0
        $histCapped = 0.0
        $overCentersCount = 0
        $activeCentersCount = 0
        
        function Get-CapForLocal($center, $cat, $mKey) {
            $k = "$center||$cat"
            if ($capsByMonth[$mKey].ContainsKey($k)) {
                return $capsByMonth[$mKey][$k]
            }
            if ($STANDARD_CAPS.ContainsKey($cat)) {
                return $STANDARD_CAPS[$cat]
            }
            return 99999.0
        }
        
        foreach ($cName in $monthlyCcSpend.Keys) {
            $catsList = @()
            $cTotal = 0.0
            $cOver = 0.0
            $cOvercatsCount = 0
            
            foreach ($catName in $monthlyCcSpend[$cName].Keys) {
                $spend = $monthlyCcSpend[$cName][$catName]
                $cap = Get-CapForLocal $cName $catName $monthKey
                $over = [Math]::Max(0.0, $spend - $cap)
                
                $catsList += @{
                    cat = $catName
                    spend = [Math]::Round($spend, 2)
                    cap = [Math]::Round($cap, 2)
                    over = [Math]::Round($over, 2)
                }
                
                $cTotal += $spend
                $cOver += $over
                if ($over -gt 0) { $cOvercatsCount++ }
            }
            
            $catsList = $catsList | Sort-Object @{Expression={$_.spend}; Descending=$true}
            
            $centerDetails[$cName] = @{
                name = $cName
                cats = $catsList
                total = [Math]::Round($cTotal, 2)
                over = [Math]::Round($cOver, 2)
                over_cats = $cOvercatsCount
            }
            
            $histOver += $cOver
            $histCapped += ($cTotal - $cOver)
            $activeCentersCount++
            if ($cOver -gt 0) { $overCentersCount++ }
        }
        
        # Build Top Over Centers for historical month
        $topOverCenters = @()
        $sortedCenterNames = $centerDetails.Keys | Sort-Object @{Expression={$centerDetails[$_].over}; Descending=$true}
        foreach ($nm in $sortedCenterNames) {
            if ($centerDetails[$nm].over -le 0) { continue }
            
            $cMeta = $allCentersMap[$nm]
            $sd = if ($cMeta) { $cMeta.SD } else { "Unknown" }
            $d = if ($cMeta) { $cMeta.D } else { "Unknown" }
            $sm = if ($cMeta) { $cMeta.SM } else { "Unknown" }
            $stm = if ($cMeta) { $cMeta.STM } else { "Unknown" }
            
            $latVal = $null; $lngVal = $null
            if ($latLngMap.ContainsKey($nm)) {
                $latVal = $latLngMap[$nm].lat
                $lngVal = $latLngMap[$nm].lng
            }
            
            $topOverCenters += @{
                name = $nm
                sd = $sd
                d = $d
                sm = $sm
                stm = $stm
                total = $centerDetails[$nm].total
                over = $centerDetails[$nm].over
                over_cats = $centerDetails[$nm].over_cats
                lat = $latVal
                lng = $lngVal
            }
        }
        
        $catsRounded = @{}
        foreach ($k in $monthlyCatsTotals.Keys) {
            $catsRounded[$k] = [Math]::Round($monthlyCatsTotals[$k], 2)
        }
        
        # SD attribution spends for trend sparklines
        $monthlySdsSpend = @{}
        foreach ($cName in $monthlyCcSpend.Keys) {
            $cMeta = $allCentersMap[$cName]
            $sd = if ($cMeta) { $cMeta.SD } else { "Unknown" }
            if (-not $monthlySdsSpend.ContainsKey($sd)) { $monthlySdsSpend[$sd] = 0.0 }
            $monthlySdsSpend[$sd] += $centerDetails[$cName].total
        }
        
        $sdsRounded = @{}
        foreach ($k in $monthlySdsSpend.Keys) {
            $sdsRounded[$k] = [Math]::Round($monthlySdsSpend[$k], 2)
        }
        
        # Center-specific spends map for backward compatibility in expanded trend tables
        $centersRounded = @{}
        foreach ($cName in $centerDetails.Keys) {
            $centersRounded[$cName] = $centerDetails[$cName].total
        }
        
        # Save into histData
        $histData[$monthKey] = @{
            totalSpend = [Math]::Round($histOver + $histCapped, 2)
            totalOverspend = [Math]::Round($histOver, 2)
            totalCapped = [Math]::Round($histCapped, 2)
            activeCenters = $activeCentersCount
            overCenters = $overCentersCount
            categories = $catsRounded
            centerDetails = $centerDetails
            top_over_centers = $topOverCenters
            sds = $sdsRounded
            centers = $centersRounded
            
            # Backwards compatibility keys
            total = [Math]::Round($histOver + $histCapped, 2)
            total_overspend = [Math]::Round($histOver, 2)
            transactions = $monthApprovedCount
            rejected_total = [Math]::Round($monthRejected, 2)
        }
        
        Write-Host "  Success! Spends=$($histData[$monthKey].totalSpend), Leakage=$($histData[$monthKey].totalOverspend), Active=$activeCentersCount"
        
        $workbook.Close($false)
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($workbook) | Out-Null
    }
    
    # ----------------------------------------------------
    # 4. COMPILE FINAL DATABASE OVERVIEW
    # ----------------------------------------------------
    Write-Host "`nCompiling unified overview database (defaulting to May 2026)..."
    
    # Merge all unique centers list
    $allCentersList = @()
    foreach ($k in $allCentersMap.Keys) {
        $allCentersList += $allCentersMap[$k]
    }
    
    $mayData = $histData["may"]
    $monthlyTotals = @{}
    foreach ($m in $monthConfig) {
        $monthlyTotals[$m.val.ToString()] = $histData[$m.key].totalSpend
    }
    
    $outputObject = @{
        total = $mayData.totalSpend
        total_overspend = $mayData.totalOverspend
        total_capped = $mayData.totalCapped
        active_centers = $mayData.activeCenters
        over_centers = $mayData.overCenters
        rejected_total = $mayData.rejected_total
        monthly = $monthlyTotals
        categories = $mayData.categories
        center_details = $mayData.centerDetails
        top_over_centers = $mayData.top_over_centers
        caps = $STANDARD_CAPS
        capsByMonth = $capsByMonth
        hist = $histData
        raw = $rawRowsList
        deviations = $deviationsList
        allCenters = $allCentersList
    }
    
    # Serialize to JSON with deep serialization depth to prevent truncations of nested objects
    $json = ConvertTo-Json $outputObject -Depth 20 -Compress
    
    $outputPath = "c:\Users\ajitdixit.int\OneDrive\vs_code\Dashboard\data.js"
    $fileContent = "/**`n * Delhivery Expense Governance Dashboard - Compiled Spreadsheet Database`n */`n`nwindow.DelhiveryMockDB = " + $json + ";`n`nconsole.log('Real Live Database Loaded successfully from Excel!', window.DelhiveryMockDB);`n"
    
    Write-Host "Writing output database to $outputPath..."
    [System.IO.File]::WriteAllText($outputPath, $fileContent, [System.Text.Encoding]::UTF8)
    Write-Host "Spreadsheet database successfully generated!"
    
} catch {
    Write-Error $_
} finally {
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}
