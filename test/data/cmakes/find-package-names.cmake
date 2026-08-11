cmake_minimum_required(VERSION 3.16)
project(find-package-names VERSION 2.1)

find_package(ZLIB REQUIRED)
find_package(Boost 1.54 COMPONENTS date_time)
find_library(PTHREADPOOL_LIB pthreadpool REQUIRED)
find_library(MATH_LIBRARY m)
find_package(${SOME_VARIABLE} QUIET)
