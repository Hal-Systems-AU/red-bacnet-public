# Changelog

## [1.2.0]
### Added
- DiscoverPoint and ReadPoint added concurrentTaskDelay config to control delay between concurrent tasks

## [1.1.5]
### Change
- ReadPoint to not add device to task queue if no points attached to device

## [1.1.4]
### Added
- DiscoverPoint added new discover mode: Analog and Binary only

## [1.1.3]
### Change
- ReadPoint and WritePoint input schema to strip unknown properties instead of rejecting them

## [1.1.2]
### Change
- WritePoint to not fail if point not found in points config, only raise error

## [1.1.1]
### Added
- Unit test for BACnet string points

### Fixed
- Reading offline device points run infinitely
- Unit test failure

## [1.1.0]
### Changed
- Implemented auto resize batch size when querying using readPropertyMultiple to improve performance
- Added readPropertyMultiple to read object list to reduce query speed
- Changed strategy when discovering device name, implemented delay instead of burst to reduce traffic congestion and yield better result
- Force use readProperty to read multistate object to improve result

### Fixed
- Failure to discover device name for Forwarded NPDU devices
- Missed bacnet objects when using discover point

## [1.0.22]
### Fixed
- Removed console.log in Read Point

## [1.0.22]
### Fixed
- Read Point supports string reading

## [1.0.21]
### Fixed
- Fixed discovering points failed when using BACnet router IP to ms/tp

## [1.0.20]
### Fixed
- Fixed failure to parse bacnet result with multiple property ids
