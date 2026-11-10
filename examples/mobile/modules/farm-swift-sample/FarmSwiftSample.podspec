# Laid out as a community module written in Swift is: an Objective-C++ class adopts the Codegen
# spec and calls Swift through the pod's generated <Module>-Swift.h header.
Pod::Spec.new do |s|
  s.name         = "FarmSwiftSample"
  s.version      = "0.0.0"
  s.summary      = "A React Native module written in Swift."
  s.homepage     = "https://github.com/farming-labs/farm.js"
  s.license      = "MIT"
  s.author       = "Farm.js"
  s.platform     = :ios, "16.0"
  s.source       = { :path => "." }
  s.source_files = "ios/*.{h,mm,swift}"
  s.dependency "React-Core"
end
