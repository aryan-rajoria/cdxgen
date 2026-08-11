cmake_minimum_required(VERSION 3.14)
project(sampleapp VERSION ${MYPROJ_VERSION} LANGUAGES CXX)
set(MYPROJ_VERSION 2.4.1)
include(FetchContent)
FetchContent_Declare(
    tinyjson
    GIT_REPOSITORY https://github.com/elementalcow/tinyjson.git
    GIT_TAG v3.11.3
)
FetchContent_MakeAvailable(tinyjson)
find_package(ZLIB REQUIRED)
