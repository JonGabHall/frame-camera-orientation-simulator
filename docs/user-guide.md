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
| Close-up diagram | Sensor mount relative to a fixed vehicle body frame | How do lever arm and boresight alter the sensor? |

Use the divider handles to change the relative size of the views. In the 3D view, click the ground
to move the vehicle's horizontal position. Use the crosshair button to return the view to the
vehicle. The close-up supports either pan or rotate drag modes and can show its own legend.

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

## Interpretation limits

The simulator intentionally has no terrain, obstruction, lens-distortion, sensor-timing, or
georeferencing-error model. A footprint means the intersection of ideal pinhole rays with the
configured flat plane, not a prediction of usable imagery coverage in an operational collection.