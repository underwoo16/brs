sub Main()
    _brs_.mockComponent("roTimespan", {
        mark: (sub()
            print "marking mock timespan"
        end sub),
        totalMilliseconds: (function()
            return 8
        end function)
    })
    mockTimespan = createObject("roTimespan")
    print "created mock: "mockTimespan
    mockTimespan.mark()
    print "mocked timespan should return 8: " mockTimespan.totalMilliseconds()  ' => 8
end sub
