# User Guide

## Start with the default state

The default state shows a level vehicle at 120 meters with a downward-looking sensor. The left
panel holds all inputs. Change one value, select **Generate**, and compare the solid current result
with the dashed previous frustum and projected target.

## Read the views together

| View | What it shows | Useful question |
| --- | --- | --- |
| 3D world view | Vehicle, resolved sensor, frustum, footprint, ground target | Where do the camera rays go? |
| Image-space view | The target after pinhole projection into the image frame | What would this target look like in the raster? |
| Close-up diagram | Vehicle and resolved sensor in their current orientations | How do vehicle attitude, lever arm, and boresight affect the camera? |

Use the divider handles to change the relative size of the views. In the 3D view, click the ground
to move the vehicle's horizontal position. Use the crosshair button to return the view to the
vehicle. The close-up supports either pan or rotate drag modes and can show its own legend.
It is centered on the vehicle and uses an illustrative ground plane, rather than the actual
vehicle altitude and ground elevation.

The sample target stays at a fixed ground location in the world view as the vehicle moves. It may
leave the image frame; the image-space arrow indicates the direction of its center when it is off-frame.

## Explore orientations

1. Enable the vehicle F/R/D axes and the heading/pitch/roll rotation guides.
2. Change **Heading** while leaving pitch at $90^\circ$ and roll at $0^\circ$. The vehicle turns
   around the Down axis.
3. Change **Pitch** to see the nose move between down, horizontal, and up.
4. Change **Roll / bank** to rotate about the vehicle Forward axis.
5. Open **Sensor mount: boresight** and alter its pitch. A mount pitch of $0^\circ$ points the
   resolved sensor toward nadir; $90^\circ$ aligns it with the vehicle nose.

The body-axis colors are consistent in the guides: Forward/Roll is green, Right/Pitch is orange,
and Down/Heading is magenta. Sensor axes use the same colors with a dashed treatment.

## Explore camera geometry

- Raise **Vehicle altitude** to enlarge a downward-looking footprint.
- Increase **Focal length** to narrow the field of view; reduce it to widen the field of view.
- Change sensor width or height to change horizontal or vertical field of view independently.
- Offset the principal point to move the optical center in the raster frame.
- Change **Image rotation** to rotate only the projected image content. It does not turn the 3D
  camera, so it does not change the frustum or ground footprint.
- Aim near the horizon to see why a finite ground footprint may no longer be meaningful.

## Compare states

**Show previous frustum/footprint** preserves the prior generated state as a dashed, faded
reference. It is intended for one-change-at-a-time experiments. Disable it when the overlay no
longer helps, or select **Reset Parameters** to return to the default state.

## Compare camera table values

Open **Camera table values** and select **Frame camera** or **Oriented imagery** to compare the
last generated camera using the corresponding field names. These values are read-only; the existing
vehicle, mount, and camera controls remain adjustable. Pending slider edits are reflected after
**Generate**. Map clicks, record imports, and reset also update the comparison.

The frame view combines values from Esri's Frames and Cameras tables. Frame-camera focal length,
principal point, and pixel size are shown in microns; a single pixel size is unavailable for
non-square pixels. Omega/Phi/Kappa are not shown because the simulator's rotation convention has
not been verified against Esri's. Oriented-imagery camera angles and height describe the resolved
camera, not the vehicle. Height uses the simulated flat ground plane, and fields of view are derived
from focal length and sensor dimensions. Image rotation is the simulator's approximation of that
field, not a verified Esri viewer transform. X/Y/Z and PerspectiveX/Y/Z are local simulator
coordinates, not georeferenced table values; neither view is an export-ready record.

Local X points east, Y north, and Z up. With default settings, the vehicle is at (0, 0, 120) m and
the sensor is 1.7 m forward and 5 m down, so the resolved sensor is at (0, 1.7, 115) m. These offsets
rotate with the vehicle; changing the ground elevation changes camera height above ground, not Z.

### Verifying OPK

The simulator's OPK round-trip tests check internal consistency, not compatibility with Esri. To
establish an independent reference, use an [oriented imagery table](https://doc.esri.com/en/arcgis-pro/latest/help/data/imagery/oriented-imagery-table.html)
with an accessible image, a spatial reference, camera coordinates, and known Omega/Phi/Kappa values.
Omit competing heading, pitch, roll, and matrix inputs, then use ArcGIS Pro's
[Add Images To Oriented Imagery Dataset](https://doc.esri.com/en/arcgis-pro/latest/tool-reference/oriented-imagery/add-images-to-oriented-imagery-dataset.html)
and compare the resulting camera orientations against the simulator. Include zero, positive and
negative single-axis, and mixed-angle cases. Compare camera axes or projections after aligning the
coordinate and image-axis conventions, since different angle triples can describe the same pose.
The ArcGIS Pro tool requires a Standard or Advanced license.

Oriented Imagery OPK verification alone does not establish compatibility with Frame Camera tables.
Validate the Frame Camera workflow separately, including its `AngleDirection`, `Polarity`, and
`FilmCoordinateSystem` settings, against an independent ArcGIS result. OPK remains unavailable in
the comparison until the applicable conventions are verified.

## Inspect an oriented imagery record

Open **Import Oriented Imagery Record** and paste JSON, CSV with a header row and one or more records,
or a pipe-separated `CameraOrientation` string. You can also open a CSV or JSON file. Use actual
field names rather than aliases. JSON can be a record, an ArcGIS feature with `attributes`, an array,
or an Esri feature set. Select **Review records and fields**, choose a record when there is more
than one, and uncheck fields to exclude them from the import. This does not alter the source. Select
**Apply record**; a single pasted record can also be applied directly without review.

To look up a published record, open **Find record in OI layer**, enter the HTTPS FeatureServer or
MapServer service or layer URL, or an ArcGIS Online oriented imagery item ID, and
enter its numeric **ObjectID**.
If the service has multiple oriented imagery layers, use a layer URL ending in its layer number.
The query retrieves only that record. Access depends on the layer's
query permissions, browser CORS, and ArcGIS authentication; secured services may require a sign-in
configuration not provided by this application. ArcGIS Enterprise portal item IDs are not supported
here; use the layer URL. Do not include tokens or credentials in the URL. The query imports record
attributes, not layer-level default camera values; missing fields retain the current simulator values.
ObjectIDs identify records within a layer and may change when data is republished.

The supported camera heading, pitch, roll, height, FOV, and image rotation values populate the
simulator. Type 1 `CameraOrientation` angles are used when the corresponding individual fields are
missing. All other nonempty fields are reported as not applied. Unsupported orientation types and
panoramic fields of view cannot be simulated as frame cameras.

The record describes the resolved camera, not the vehicle and its mount. The simulator therefore
uses a level illustrative vehicle and a zero lever arm. Camera height is above the flat ground plane;
FOV-based sensor dimensions use the supplied or current focal length and are not independently
measured sensor dimensions. The
record's coordinates, image, distortion, affine calibration, and near/far distances are not applied.
Values outside the original control range expand that range instead of being silently clipped.
For focal length and principal point values, add `FocalLengthUnit` as `mm` or `microns` to the JSON;
this extra key is not an OID field. Pixel units and affine calibration are not supported. Missing
supported values retain the current simulator settings. When focal length changes, sensor dimensions
are adjusted as needed to preserve any fields of view that were not supplied.

## Compare synthetic image-to-ground positions

Select a point in the synthetic image view to establish a reference. After changing parameters and
selecting **Generate**, the 3D view shows the reference ground point in white and the current point
in yellow, with their east/north shift in meters. Select another point to establish a new reference.
The comparison uses the same normalized image position and the simulator's flat plane; a ray that
does not reach that plane cannot be compared. It is not a projection of the original photograph.

For a real image and map comparison, Esri's [oriented imagery viewer](https://developers.arcgis.com/javascript/latest/references/map-components/components/arcgis-oriented-imagery-viewer/)
provides a map-image location tool. It requires an accessible oriented imagery layer and image;
its results can differ from this idealized simulator.

## Interpretation limits

The simulator intentionally has no terrain, obstruction, lens-distortion, sensor-timing, or
georeferencing-error model. A footprint means the intersection of ideal pinhole rays with the
configured flat plane, not a prediction of usable imagery coverage in an operational collection.